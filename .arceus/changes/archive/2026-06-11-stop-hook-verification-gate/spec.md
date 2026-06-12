# Spec — Stop hook verification gate

## 需求描述

### 使用者故事

身為使用 Arceus 的開發者，當 AI 修改了程式碼之後準備結束回合時，我希望系統自動檢查「最後一次 code edit 之後有沒有跑過成功的 verification」。如果沒有，advisory 模式印一行警告提醒我（zero friction），strict 模式直接阻止 AI 結束並指示它補跑驗證。這樣即使 AI 忽略了 `subagent-stop.ts` 的提醒，stop gate 也能在每回合出口攔截。

### 功能列表

#### F1. `post-tool-use.ts` 結構化事件記錄

在既有的 `tool_use` 事件（`post-tool-use.ts:16-24`）之外，新增兩種結構化事件：

**F1a. `code_edit` 事件**：當 `tool_name` 為 `Edit`、`Write`、`MultiEdit`、`NotebookEdit` 之一時，額外 log：
```ts
{
  timestamp: string,
  event: "code_edit",
  data: {
    tool: string,           // "Edit" | "Write" | "MultiEdit" | "NotebookEdit"
    file_path: string,      // 從 tool_input 提取（見下方邏輯）
  }
}
```

file_path 提取邏輯（基於 `PostToolUseInput.tool_input: Record<string, unknown>`，types.ts:38）：
- `Edit` / `Write`：`tool_input.file_path`（string）
- `MultiEdit`：`tool_input.file_path`（string，若不存在則嘗試 `(tool_input.edits as unknown[])?.[0]?.file_path`）
- `NotebookEdit`：`tool_input.notebook_path`（string）
- 所有情況下，若欄位缺失或型別不是 string，fallback 為 `"unknown"`

`file_path` 為 `"unknown"` 時，不匹配任何 exclusion pattern（保守策略：寧可多 gate 一次，不漏放）。

**F1b. `verification_run` 事件**：當 `tool_name === "Bash"` 且 `tool_input.command` 匹配驗證指令 pattern 時，log：
```ts
{
  timestamp: string,
  event: "verification_run",
  data: {
    kind: string,   // "typecheck" | "lint" | "test" | "build" | "verify" | "unknown"
    command: string, // 截斷至 200 字
    ok: boolean,     // true if tool_response 不含 failure markers
  }
}
```

驗證指令 pattern（硬編碼，取自 `CLAUDE.md` 的 `npm run` 指令 + 常見 equivalents）：
- `typecheck`: `/\b(tsc\b|typecheck)/`
- `lint`: `/\b(eslint|lint)\b/`
- `test`: `/\b(vitest|jest|mocha|npm\s+(?:run\s+)?test)\b/`
- `build`: `/\b(tsup|webpack|esbuild|npm\s+(?:run\s+)?build)\b/`
- `verify`: `/\bnpm\s+run\s+verify\b/`

Pattern 硬編碼而非從 `config.verification`（`config.ts:14-19`）讀取——`config.verification` 的 value 是 override command string（如 `"pnpm test"`），不是 detection pattern；兩者用途不同。此為 v1 已知限制（見 Decision 6）。

**Package-management guard**（對抗式審查修正）：command 先以 `&&` / `||` / `;` / `|` 切成 segments；匹配 `/\b(npm|pnpm|yarn|bun)\s+(install|i|uninstall|add|remove|link|ci)\b/` 的 segment 不參與 verification 分類。避免 `npm install jest` 產生幽靈 `verification_run`（ok=true）騙過 strict gate；`npm install jest && npm test` 仍由第二個 segment 正常計入 kind=test。

`ok` 判定（failure-marker heuristic）：`tool_response`（字串化後——runtime 實測為 object，先經 JSON.stringify）不包含以下任一 marker 則 `ok = true`：
- `/error\s+TS\d/i` （TypeScript compiler errors）
- `/[1-9]\d*\s+errors?\b/i`（generic error count；排除 "0 errors" 成功摘要——對抗式審查修正）
- `/\bFAIL\b/`（vitest/jest test failure）
- `/\bERR!/`（npm error；結尾不加 `\b`——真實 npm 輸出是 `ERR! `，`!` 後接空格/換行，trailing word boundary 永遠不成立——對抗式審查修正）
- `/exit code [1-9]/i`（non-zero exit，文字形式）
- `/"exitCode":\s*[1-9]/`（object 形式 tool_response 經 JSON.stringify 後的 non-zero exit——對抗式審查修正）
- `/Command failed/i`

此 heuristic 有已知 false negative（verification 失敗但 marker 不在 truncated 500 字內）——見 Decision 3。

`npm run verify` 被歸為 kind `"verify"`，在 gate predicate 中視為充分驗證（any-one-suffices 邏輯下與任何單項 kind 等效）。

非驗證的 Bash 命令不產出 `verification_run` 事件。

**F1c. `typeof` guard for `tool_response`**：在 `truncate()` 呼叫前加型別防禦：
```ts
const responseStr = typeof input.tool_response === "string"
  ? input.tool_response
  : JSON.stringify(input.tool_response ?? "");
```
修復原因：`truncate(input.tool_response, 500)`（post-tool-use.ts:22）的 `str` 參數型別宣告為 `string`，但 runtime 可能收到 object。此時 `str.length` 回傳 `undefined`，`undefined > 500` 為 `false`，object 被原樣回傳給外層 `JSON.stringify`——不 throw TypeError 但造成靜默資料損壞（event data 格式不符 `SessionEvent` 預期）。同樣處理 `truncate(JSON.stringify(input.tool_input), 500)` 的 `tool_input` 輸入。

**F1d. 補齊 `significantTools`**：從 `["Bash", "Edit", "Write", "Agent"]`（post-tool-use.ts:14）改為 `["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Agent"]`，對齊 `pre-tool-use.ts:15-20` 的 `MODIFYING_TOOLS`。

**F1e. 事件分類函式作為 `post-tool-use.ts` 的本地函式**：`classifyCodeEdit()` 和 `classifyVerificationRun()` 各自 inline 在 `post-tool-use.ts` 中（不建立獨立的 `event-classifier.ts` 模組），在 main() 中既有 `logEvent("tool_use")` 呼叫之後依序呼叫，各自 try/catch，失敗不影響 `passThrough()`。

#### F2. Stop gate predicate（`src/hooks/stop-gate.ts`）

新增純函式模組 `src/hooks/stop-gate.ts`，不做 I/O，export：

```ts
interface StopGateConfig {
  enabled: boolean;
  requireVerify: boolean;
  excludedPaths: string[];
}

interface StopGateInput {
  events: SessionEvent[];
  config: StopGateConfig;
  stopHookActive: boolean;
}

interface StopGateResult {
  action: "pass" | "warn" | "block";
  reason?: string;
  editedFiles: string[];
}

function evaluateStopGate(input: StopGateInput): StopGateResult;
function isExcludedPath(filePath: string, excludedPaths: string[]): boolean;
```

Gate predicate 邏輯：
1. 若 `config.enabled === false`：回傳 `{ action: "pass" }`
2. 若 `stopHookActive === true`：回傳 `{ action: "pass" }`（loop protection——見 Decision 4）
3. 收集所有 `event === "code_edit"` 事件，以 `isExcludedPath()` 過濾掉 `data.file_path` 匹配 `excludedPaths` 的事件
4. 若過濾後無 `code_edit` 事件：回傳 `{ action: "pass" }`
5. 取最後一筆 non-excluded `code_edit` 在 events array 中的 index 為 `lastEditIndex`（使用 array index 而非 timestamp 字串比較——session log 是 append-only JSONL，index 即時序，不依賴時鐘精度，見 Decision 5）
6. 在 `lastEditIndex` 之後找任何 `event === "verification_run"` 且 `data.ok === true` 的事件
7. 若至少一筆 → 回傳 `{ action: "pass" }`（已驗證）
8. 否則：
   - `config.requireVerify === true`（strict）：回傳 `{ action: "block", reason: "<instructions>", editedFiles }`
   - `config.requireVerify === false`（advisory）：回傳 `{ action: "warn", reason: "<warning>", editedFiles }`

`editedFiles` 為所有 non-excluded `code_edit` 的 `file_path` 去重後的列表（最多 10 筆，供 reason 引用）。

#### F3. Stop hook 改寫（`stop.ts`）

現有 `stop.ts`（27 行）的 main() 改為：
1. 讀取 `input`（`readStdin<StopInput>()`）
2. `logEvent("session_stop")`（**先**記錄 session stop 事件，確保即使 gate 內部 throw 被 catch 後 passThrough，事件仍然被記錄）
3. 讀取 config（`readConfig(arceusDir)`）。若 `config.stopGate?.enabled === false`：`passThrough()`（config 缺失時以預設值繼續執行 gate）
4. 若 `input.stop_hook_active === true`：`writeOutput({ continue: true, systemMessage: <F7 bypass 訊息> })` 後 return——置於 enabled 檢查之後，disabled gate 不發任何 Arceus 訊息（`stop_hook_active` 可能由其他 plugin 的 Stop hook block 造成）
5. 讀取 session log（`readSessionLog(arceusDir, input.session_id)`）——wrapped in try/catch，fail-open
6. 建構 `StopGateConfig`（從 config 讀取 + 填入預設值）
7. 呼叫 `evaluateStopGate({ events, config: gateConfig, stopHookActive: false })`——`true` 的情況已在步驟 4 提前 return；純函式仍保留 loop-protection 分支（F2 step 2）作為 API 完整性與可測性
7. 依 result.action 分支：
   - `"pass"`：`passThrough()`
   - `"warn"`：`writeOutput({ continue: true, systemMessage: result.reason })`
   - `"block"`：`writeOutput({ decision: "block", reason: result.reason })`

**fail-open 包裝**：整個 gate 邏輯（步驟 3-7）包在 try-catch 中。任何 Error → `process.stderr.write("[arceus] stop-gate internal error: <message>, passing through.\n")` + `passThrough()`。

#### F4. StopInput 擴充（`types.ts`）

```ts
export interface StopInput extends HookBaseInput {
  hook_event_name: "Stop";
  /** True when the assistant is continuing because a prior Stop hook blocked. */
  stop_hook_active?: boolean;
}
```

#### F5. Config schema（`config.ts`）

`ArceusProjectConfig` 新增：
```ts
/** Stop hook verification gate — checks session log for unverified code edits. */
stopGate?: {
  /** Master switch. When false the gate is fully bypassed. Defaults to true. */
  enabled?: boolean;
  /**
   * Strict mode: when true, unverified code edits block the stop.
   * Defaults to false (advisory: systemMessage warning only).
   * Naming mirrors checkSpec.requireApprove (require + 動詞).
   */
  requireVerify?: boolean;
  /**
   * Path patterns excluded from triggering the gate.
   * Prefix match for entries ending in "/" (e.g. ".arceus/").
   * Suffix match for entries starting with "*" (e.g. "*.md").
   * Exact match otherwise.
   * Defaults to [".arceus/", "*.md"].
   * Edits to these paths alone do not require npm verification.
   */
  excludedPaths?: string[];
};
```

預設值（在 `stop.ts` gate 邏輯中 hardcode，與 `readConfig` catch → `{}` 一致）：
- `enabled`: `true`
- `requireVerify`: `false`（advisory）
- `excludedPaths`: `[".arceus/", "*.md"]`

三態行為表（鏡像 `checkSpec` 的設計，`config.ts:23-34`）：

| `enabled` | `requireVerify` | 行為 |
|---|---|---|
| `false` | (any) | 完全旁路，行為等同目前（log + passThrough）|
| `true` | `false`（**預設**） | **Advisory**：未驗證時 `systemMessage` 警告但不 block |
| `true` | `true` | **Strict**（team opt-in）：未驗證時 `decision: "block"` + reason |

#### F6. Path exclusion matching

`isExcludedPath(filePath, excludedPaths)` 匹配規則（不引入 glob library，不引入 npm dependency）：
- 以 `/` 結尾的項（如 `.arceus/`）= prefix match：`filePath.includes(item.slice(0, -1))`
- 以 `*` 開頭的項（如 `*.md`）= suffix match：`filePath.endsWith(item.slice(1))`
- 其他 = exact match
- `filePath` 為 `"unknown"` 時：回傳 `false`（不排除——保守策略）

#### F7. 訊息格式

Block reason（注入給 Claude，strict 模式）：
```
[Arceus Stop Gate] Code was edited but no successful verification found after the last edit.
Unverified files: <file list, max 10>
Run verification before finishing: npm run verify (or: npm run typecheck && npm run lint && npm run test && npm run build).
驗證尚未通過，請先執行驗證指令再結束。
```

Advisory systemMessage（使用者可見）：
```
[Arceus Stop Gate] Code was edited but no successful verification found after the last edit. Consider running 'npm run verify'.
Set stopGate.requireVerify=true in .arceus/config.json for hard gating.
程式碼已被修改但尚未通過驗證。
```

Loop protection passThrough（strict 模式，`stop_hook_active === true`）附帶 systemMessage：
```
[Arceus Stop Gate] Verification gate bypassed after a previous block. Check verification status manually.
```

格式鏡像 `pre-tool-use.ts:40-41` 的 `[Arceus Preflight]` prefix + 英文指示 + 結尾一行繁體中文 guidance。

## 驗收條件

- [ ] **AC1 (code_edit logged)**: `post-tool-use.ts` 在 `tool_name === "Edit"` 時，session log 新增一筆 `event: "code_edit"`，`data.file_path` 含實際路徑
- [ ] **AC2 (verification_run logged)**: `post-tool-use.ts` 在 `tool_name === "Bash"` 且 command 匹配 `npm run test` 時，session log 新增一筆 `event: "verification_run"`，`data.kind === "test"`，`data.ok === true`（若回應無 failure marker）
- [ ] **AC3 (verification_run fail)**: `Bash` tool 執行 `npm run test` 且 tool_response 含 `FAIL` 時，`data.ok === false`
- [ ] **AC4 (MultiEdit/NotebookEdit tracked)**: `significantTools` 包含 `"MultiEdit"` 和 `"NotebookEdit"`；`code_edit` 事件在這兩種 tool 觸發時也被 log（NotebookEdit 的 file_path 取自 `tool_input.notebook_path`）
- [ ] **AC5 (typeof guard)**: `post-tool-use.ts` 在 `tool_response` 為 object（非 string）時不產生損壞的 event data，事件仍正確 log
- [ ] **AC6 (StopInput type)**: `types.ts` 的 `StopInput` 包含 `stop_hook_active?: boolean`
- [ ] **AC7 (advisory default)**: 預設 config（無 `.arceus/config.json`）下，session log 有 `code_edit` 但無後續 `verification_run`，Stop hook 輸出含 `systemMessage`（warning），**不**含 `decision: "block"`
- [ ] **AC8 (strict block)**: `config.stopGate.requireVerify === true` 時，同上情境，Stop hook 輸出 `decision: "block"` + `reason` 含「Run verification」指示
- [ ] **AC9 (pass when verified)**: session log 有 `code_edit` 後接一筆 `verification_run` with `ok === true`（array index 更大），Stop hook 輸出 `passThrough()`
- [ ] **AC10 (loop protection)**: `stop_hook_active === true` 且 gate enabled 時，無論 session log 狀態，Stop hook 必定放行且不得 block——以 `writeOutput({ continue: true, systemMessage: <bypass 警告> })` 形式；`stopGate.enabled === false` 時則純 `passThrough()`、不發任何 Arceus 訊息
- [ ] **AC11 (fail-open)**: `readSessionLog` 因 corrupt log 而 throw 時，Stop hook 不 throw、不 block，走 `passThrough()` + stderr 含 warning
- [ ] **AC12 (path exclusion .arceus/)**: session log 只有 `.arceus/` 下的 `code_edit`，Stop hook 不觸發 gate
- [ ] **AC13 (md exclusion)**: session log 只有 `*.md` 的 `code_edit`，Stop hook 不觸發 gate
- [ ] **AC14 (disabled)**: `config.stopGate.enabled === false` 時，Stop hook 直接 `passThrough()`，不讀 session log
- [ ] **AC15 (no edits)**: session log 中無任何 `code_edit` 事件時，Stop hook 直接 `passThrough()`
- [ ] **AC16 (config schema)**: `ArceusProjectConfig` interface 包含 `stopGate` 區塊，各欄位 optional，`npm run typecheck` 通過
- [ ] **AC17 (npm run verify)**: 所有修改完成後，`npm run verify`（typecheck + lint + test + build）全綠

## 技術假設

1. Claude Code 在 Stop hook input 中傳送 `stop_hook_active: true` 來指示「上一輪 Stop hook 已經 block 過」。`StopInput` 目前沒有這個欄位（types.ts:51-53）——新增後，若 Claude Code 不傳此欄位，值為 `undefined`（falsy），gate 正常執行，loop protection 不生效但也不會造成 infinite loop（因為 AI 會在 reason 指示下跑完驗證，下一輪 gate 自然 pass）
2. `PostToolUse` hook 在 subagent（如 `arceus:tester`）的 tool call 時也會觸發，使用相同的 `session_id`，因此 subagent 跑的 verification 也會被記錄到同一份 session log。`HookBaseInput` 有 optional `agent_id` / `agent_type` 欄位（types.ts:13-14）支持此假設。此假設需要 instrumentation spike 驗證（T-1）
3. `readSessionLog` 回傳的事件按 append 順序排列（session-log.ts:41-45，逐行 `.map(JSON.parse)`），可直接用 array index 比較時序
4. `tool_input.file_path`（Edit/Write）、`tool_input.notebook_path`（NotebookEdit）是 Claude Code 傳入 PostToolUse 的欄位名稱。MultiEdit 的結構待 spike 確認（可能是頂層 `file_path` 或 `edits[0].file_path`）。若欄位名稱有變動，`code_edit` 的 `file_path` 會 fallback 到 `"unknown"`
5. tsup `noExternal: [/.*/]`（tsup.config.ts:36）配合 `external` 清單（tsup.config.ts:37，包含 `node:fs` 和 `node:path`），確保 `stop.ts` 可以 import `stop-gate.ts`、`../state/session-log.js`、`../state/config.js` 並被 bundle 成 standalone。目前 `stop.ts` 已 import `../state/index.js`，先例已確立
6. `hooks/hooks.json` 的 Stop hook timeout 為 5 秒（line 68），`readSessionLog` 的 file I/O 在合理 session log 大小（< 10MB）下遠在此限內
7. verification command pattern 硬編碼而非從 `config.verification`（config.ts:14-19）讀取——`config.verification` 的 value 是 override command string（如 `"pnpm test"`），不是 detection pattern；兩者用途不同
8. `Bash` 工具的 `echo >` / `cat <<` / `sed -i` 也可能修改檔案，但從 truncated command string 提取路徑不可靠——明確不處理，只追蹤 Edit/Write/MultiEdit/NotebookEdit 四種 first-class 修改工具
