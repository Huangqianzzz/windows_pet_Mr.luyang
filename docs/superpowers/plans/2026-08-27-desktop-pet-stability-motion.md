# 人物桌宠稳定性、移动与流畅度修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复人物桌宠点击失效、窗口后方抽搐、最大化/全屏干扰和狭缝卡死，并通过独立第二阶段实现子像素平滑移动。

**Architecture:** 保留 Electron 的人物渲染、命中输入和气泡三个窗口。第一阶段稳定输入窗口，增加前台后台门控，并把自主路线与碰撞脱困拆成可测试的纯逻辑；第二阶段增加局部渲染缓冲区，使视觉位置使用 `requestAnimationFrame` 子像素插值，而碰撞、点击和气泡继续使用统一的全局 DIP 坐标。

**Tech Stack:** Electron 41、Node.js `node:test`、Koffi Win32 FFI、HTML/CSS/JavaScript、electron-builder NSIS x64。

## Global Constraints

- 运行目标为 Windows 10/11 x64。
- 保留现有人物素材，不重新生成、不美颜、不改变服装和面部表现。
- 保留语音、粉色气泡、跪下互动、休息、缩放、桌面图标碰撞和开机启动。
- 最大化或全屏程序位于前台时，桌宠暂停并沉到后台；恢复后继续原状态。
- 普通路线以左右爬行为主，只加入缓慢斜向、弧线和上下绕行。
- 只有真实应用窗口可以成为攀爬支撑；任务栏和桌面图标只能阻挡。
- 支撑消失后自然掉落；不得瞬移、穿过窗口或永久卡死。
- 第一阶段验收通过后才能开始第二阶段平滑渲染。
- 新安装包通过全部验收前不得覆盖现有正式安装包。
- 当前五个本地源码/测试修改是设计前试验草稿，不作为实现基线。

---

### Task 0: 恢复干净实现基线

**Files:**
- Restore: `src/main.js`
- Restore: `src/runtime/autonomous-roam.js`
- Restore: `src/runtime/pet-controller.js`
- Restore: `test/autonomous-roam.test.js`
- Restore: `test/pet-controller.test.js`

**Interfaces:**
- Consumes: 已提交规格 `docs/superpowers/specs/2026-08-27-desktop-pet-stability-motion-design.md`。
- Produces: 与提交 `001a86f` 一致且测试全绿的实现基线。

- [ ] **Step 1: 核对只有设计前草稿处于未提交状态**

Run:

```powershell
git status --short
git diff -- src/main.js src/runtime/autonomous-roam.js src/runtime/pet-controller.js test/autonomous-roam.test.js test/pet-controller.test.js
```

Expected: 仅列出上述五个已知草稿和本计划文件；发现其他改动立即停止，不执行恢复。

- [ ] **Step 2: 恢复五个试验草稿**

```powershell
git restore -- src/main.js src/runtime/autonomous-roam.js src/runtime/pet-controller.js test/autonomous-roam.test.js test/pet-controller.test.js
```

- [ ] **Step 3: 验证基线**

Run: `npm test`

Expected: `172` 项测试通过，`0` 项失败。

---

### Task 1: 让点击窗口持续稳定存在

**Files:**
- Modify: `src/runtime/pet-controller.js`
- Modify: `src/main.js`
- Modify: `test/pet-controller.test.js`
- Modify: `test/hit-window.test.js`

**Interfaces:**
- Consumes: `PetController.setFrameHitBox(hitBox)`、`renderWindow`/`hitWindow` 适配器。
- Produces: `hitRegionVisible: boolean` 内部状态；命中窗口仅在首次有效命中时显示，仅在掉落、后台或无效命中时隐藏。
- Produces: `PetController.setInputEnabled(enabled: boolean): boolean`，后台模式关闭输入，恢复时按当前帧区域重新开放输入。

- [ ] **Step 1: 写命中窗口生命周期失败测试**

在 `test/pet-controller.test.js` 增加：首次有效帧应产生一次 `show`；随后 300 次帧区域和位置更新不得增加 `show`/`hide` 次数；无效命中或 `supportLost()` 才允许隐藏。

```js
test("frame updates keep one continuous hit-window lifetime", () => {
  const harness = createHarness();
  harness.controller.startCrawl("right");
  harness.controller.setFrameHitBox({ x: 2, y: 3, width: 10, height: 12 });
  for (let index = 0; index < 300; index += 1) {
    harness.controller.setFrameHitBox({ x: 2 + index % 2, y: 3, width: 10, height: 12 });
    harness.controller.moveCrawl(0.1, 0, { x: 0, y: 0, width: 500, height: 500 });
  }
  assert.equal(harness.hitEvents.filter(event => event.type === "show").length, 1);
  assert.equal(harness.hitEvents.filter(event => event.type === "hide").length, 0);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/pet-controller.test.js`

Expected: FAIL，`show` 和 `hide` 数量随帧数增加。

- [ ] **Step 3: 实现连续命中生命周期**

在 `PetController` 中加入 `hitRegionVisible` 和 `inputEnabled`。`setFrameHitBox()` 对有效区域直接保存并调用 `#showCurrentHitRegion()`；`#moveBody()` 只更新边界；`#showCurrentHitRegion()` 仅在输入已启用且 `hitRegionVisible === false` 时调用 `showInactive()`；`#hideHitRegion()` 只隐藏一次并清除状态。`setInputEnabled(false)` 隐藏输入，`setInputEnabled(true)` 使用当前有效帧恢复输入。

在 `liveWindowAdapter()` 中调用 `getBounds()`/`isVisible()`，相同边界不执行 `setBounds()`，已显示窗口不重复 `showInactive()`。

- [ ] **Step 4: 验证输入单元测试**

Run: `node --test test/pet-controller.test.js test/hit-window.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: 提交第一项稳定性修复**

```powershell
git add src/runtime/pet-controller.js src/main.js test/pet-controller.test.js test/hit-window.test.js
git commit -m "fix: keep desktop pet input window stable"
```

---

### Task 2: 检测最大化/全屏前台窗口并进入后台

**Files:**
- Create: `src/windows/foreground-window.js`
- Create: `src/runtime/foreground-gate.js`
- Create: `test/foreground-window.test.js`
- Create: `test/foreground-gate.test.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/render/pet-renderer.js`
- Modify: `test/pet-renderer.test.js`

**Interfaces:**
- Produces: `createForegroundWindowReader().snapshot(): ForegroundSnapshot | null`。
- `ForegroundSnapshot = { hwnd, processId, rect, maximized, fullscreen }`。
- Produces: `createForegroundGate({ settleMs }).tick(backgroundRequested, now): "enter" | "leave" | "none"`。
- Produces renderer event: `desktop-pet:background-mode` with `{ paused: boolean }`。

- [ ] **Step 1: 写前台分类与稳定门失败测试**

覆盖：自身进程不触发；普通窗口不触发；`IsZoomed` 最大化触发；窗口矩形覆盖所在显示器 99.5% 触发全屏；另一显示器上的窗口不触发；状态持续 250ms 后才返回 `enter`/`leave`。

```js
test("foreground gate requires a stable state before entering background", () => {
  const gate = createForegroundGate({ settleMs: 250 });
  assert.equal(gate.tick(true, 0), "none");
  assert.equal(gate.tick(true, 249), "none");
  assert.equal(gate.tick(true, 250), "enter");
  assert.equal(gate.tick(false, 300), "none");
  assert.equal(gate.tick(false, 550), "leave");
});
```

- [ ] **Step 2: 运行新增测试并确认模块不存在**

Run: `node --test test/foreground-window.test.js test/foreground-gate.test.js`

Expected: FAIL，模块无法加载。

- [ ] **Step 3: 实现 Win32 前台读取器和纯状态门**

`foreground-window.js` 使用 Koffi 绑定 `GetForegroundWindow`、`GetWindowThreadProcessId`、`IsZoomed`、`GetWindowRect`。全屏判定只比较前台窗口与 `screen.getDisplayMatching(petBody).bounds`，不把任务栏工作区当成全屏边界。

`foreground-gate.js` 保存 `stableState`、`candidateState`、`candidateSince`，候选状态未持续 `settleMs` 时返回 `none`。

- [ ] **Step 4: 接入后台/恢复流程**

在 `main.js` 增加独立的 100ms 前台监视计时器，以及 `enterBackgroundMode()` 与 `leaveBackgroundMode()`。进入时暂停物理/自主 tick、通过 renderer freeze 能力暂停动画、调用 `controller.setInputEnabled(false)`、隐藏气泡、对三个窗口取消置顶并调用 `moveBottom()`；前台监视计时器不能随物理 tick 一起停止。恢复时先刷新窗口障碍，再恢复置顶、命中、动画和物理 tick 时间基准。

`preload.js` 只接受精确 `{ paused: boolean }` 负载并转发本地事件；`pet-renderer.js` 对 `paused: true` 调用 `player.freeze()`，对 `false` 调用 `player.resume()`。

- [ ] **Step 5: 运行后台模式测试**

Run: `node --test test/foreground-window.test.js test/foreground-gate.test.js test/pet-renderer.test.js test/runtime-tick.test.js`

Expected: 全部 PASS。

- [ ] **Step 6: 提交后台模式**

```powershell
git add src/windows/foreground-window.js src/runtime/foreground-gate.js src/main.js src/preload.js src/render/pet-renderer.js test/foreground-window.test.js test/foreground-gate.test.js test/pet-renderer.test.js
git commit -m "feat: pause desktop pet behind fullscreen apps"
```

---

### Task 3: 增加斜向、弧线与防抖转向

**Files:**
- Modify: `src/runtime/autonomous-roam.js`
- Modify: `src/runtime/runtime-tick.js`
- Modify: `test/autonomous-roam.test.js`
- Modify: `test/runtime-tick.test.js`

**Interfaces:**
- Produces movement intent: `{ kind: "move", direction, dx, dy }`，其中 `abs(dy) <= abs(dx) * 0.4` 处于正常爬行。
- Produces: `roam.blocked(now): false | "left" | "right"`，450ms 内不得重复改变路线。
- Produces: `roam.cleared()`，完整移动成功后结束临时绕障状态。

- [ ] **Step 1: 写确定性路线测试**

使用注入的随机数验证：普通移动具有非零但受限的 `dy`；垂直目标通过插值缓慢变化；连续调用 `blocked()` 不会每帧翻转；冷却结束后才允许改变朝向。

- [ ] **Step 2: 确认测试在水平旧实现上失败**

Run: `node --test test/autonomous-roam.test.js test/runtime-tick.test.js`

Expected: FAIL，旧实现 `dy === 0` 且每次 `blocked()` 都翻转。

- [ ] **Step 3: 实现路线插值和转向冷却**

在 roam 内保存 `horizontalSign`、`verticalBias`、`verticalTarget`、`lastRerouteAt` 和 `detouring`。正常 `verticalTarget` 限制在 `[-0.35, 0.35]`；每次 tick 使用不超过 `dtMs / 1200` 的比例靠近目标。首次碰撞转为沿边绕行，重复受阻且超过冷却后才翻转水平朝向。

- [ ] **Step 4: 运行路线测试**

Run: `node --test test/autonomous-roam.test.js test/runtime-tick.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: 提交运动规划器**

```powershell
git add src/runtime/autonomous-roam.js src/runtime/runtime-tick.js test/autonomous-roam.test.js test/runtime-tick.test.js
git commit -m "feat: add smooth autonomous crawl routes"
```

---

### Task 4: 沿边绕行、窗口攀爬和封闭区域脱困

**Files:**
- Create: `src/runtime/crawl-navigation.js`
- Create: `test/crawl-navigation.test.js`
- Modify: `src/runtime/pet-controller.js`
- Modify: `src/domain/pet-state.js`
- Modify: `test/pet-controller.test.js`
- Modify: `test/pet-state.test.js`

**Interfaces:**
- Produces: `resolveCrawlStep({ body, dx, dy, workArea, obstacles }): CrawlResolution`。
- `CrawlResolution = { body, moved, blockedAxes, climbCandidate }`。
- `climbCandidate = null | { target, edge: "left" | "right", t }`，只允许 `source === "window"`。
- Produces: `PetController.beginAutoClimb(climbCandidate): boolean`。

- [ ] **Step 1: 写纯导航失败测试**

覆盖完整向量、仅水平可行、仅垂直可行、任务栏/图标不可攀爬、双窗口夹缝产生最近窗口 `climbCandidate`、封闭区域返回掉落候选。所有用例使用固定矩形，不依赖 Electron。

- [ ] **Step 2: 运行导航测试并确认模块不存在**

Run: `node --test test/crawl-navigation.test.js`

Expected: FAIL，模块无法加载。

- [ ] **Step 3: 实现轴分离碰撞与攀爬候选**

`resolveCrawlStep()` 先测试完整候选，再按移动幅度从大到小测试单轴候选。连续受阻信息由控制器累计；达到阈值后，从相交或最近的 `source === "window"` 障碍中选择距离最小的左/右边缘，计算标准化 `t`。

- [ ] **Step 4: 增加自动攀爬状态事件**

在 `pet-state.js` 增加 `AUTO_ATTACH`，仅允许从 `crawling` 进入 `attached`。`PetController.beginAutoClimb()` 使用 `createAttachment()` 创建 `wall-climb` 支撑，播放现有 `wall-climb` 动画。目标失效继续复用 `supportLost()` 和现有掉落逻辑。

- [ ] **Step 5: 增加封闭区域最后保护**

控制器在攀爬和绕行均超过限定停滞时间时，选择最近窗口外缘作为掉落起点并调用 `supportLost()`。测试断言位置沿边连续变化，禁止直接设置远端自由点。

- [ ] **Step 6: 运行状态、导航和控制器测试**

Run: `node --test test/pet-state.test.js test/crawl-navigation.test.js test/pet-controller.test.js`

Expected: 全部 PASS。

- [ ] **Step 7: 提交脱困功能**

```powershell
git add src/runtime/crawl-navigation.js src/runtime/pet-controller.js src/domain/pet-state.js test/crawl-navigation.test.js test/pet-controller.test.js test/pet-state.test.js
git commit -m "feat: climb out of desktop window traps"
```

---

### Task 5: 合并窗口事件并稳定支撑判定

**Files:**
- Modify: `src/windows/window-sensor.js`
- Modify: `test/window-sensor.test.js`
- Modify: `src/main.js`
- Modify: `test/runtime-tick.test.js`

**Interfaces:**
- `createWindowSensor({ ..., debounceMs = 75, setTimeoutFn, clearTimeoutFn })`。
- `onChange(obstacles, meta)` 中 `meta.immediate` 标识明确销毁或最小化事件。
- Produces: 同一事件风暴只执行一次 `enumerateWindows()` 和一次 `onChange()`。
- Produces: 支撑丢失需要两个连续完整快照确认；明确的窗口销毁事件可立即确认。

- [ ] **Step 1: 写事件风暴失败测试**

模拟 100 个 `LOCATIONCHANGE` 事件，推进注入时钟 74ms 时枚举次数不变，推进到 75ms 后只增加一次。再覆盖 `DESTROY` 立即刷新和 `stop()` 清理待执行计时器。

- [ ] **Step 2: 运行窗口传感器测试并确认失败**

Run: `node --test test/window-sensor.test.js`

Expected: FAIL，旧实现对每个事件立即刷新。

- [ ] **Step 3: 实现尾沿合并和支撑快照确认**

窗口位置、显示、隐藏事件使用单个 75ms 尾沿计时器；销毁和最小化事件立即刷新并传递 `{ immediate: true }`。主进程记录上一个完整窗口快照，对 `{ immediate: false }` 造成的单次支撑缺失延迟到下一完整快照确认。

- [ ] **Step 4: 运行相关测试**

Run: `node --test test/window-sensor.test.js test/pet-controller.test.js test/runtime-tick.test.js`

Expected: 全部 PASS。

- [ ] **Step 5: 第一阶段完整回归并提交**

Run: `npm test`

Expected: 全部测试 PASS。

```powershell
git add src/windows/window-sensor.js src/main.js test/window-sensor.test.js test/runtime-tick.test.js
git commit -m "perf: coalesce desktop window obstacle updates"
```

---

### Task 6: 增加局部渲染缓冲区和子像素插值

**Files:**
- Create: `src/runtime/render-buffer.js`
- Create: `test/render-buffer.test.js`
- Modify: `src/main.js`
- Modify: `src/preload.js`
- Modify: `src/render/pet-renderer.js`
- Modify: `src/render/pet.css`
- Modify: `test/pet-renderer.test.js`
- Modify: `test/bubble-placement.test.js`

**Interfaces:**
- Produces: `createRenderBuffer({ margin = 96 }).place(body, { dragging = false }): RenderPlacement`。
- `RenderPlacement = { hostBounds, localX, localY, recentered }`，全部全局尺寸使用 DIP；`localX/localY` 允许小数。
- Produces renderer event: `desktop-pet:visual-offset` with exact `{ x, y }`。

- [ ] **Step 1: 写渲染缓冲纯逻辑失败测试**

覆盖首次居中、缓冲区内部只改变小数偏移、接近 32 DIP 安全边缘时重新居中、拖拽时立即重定位、缩放后仍保持人物全局锚点一致。

```js
test("subpixel movement stays inside one native host window", () => {
  const buffer = createRenderBuffer({ margin: 96, safeInset: 32 });
  const first = buffer.place({ x: 100, y: 100, width: 192, height: 208 });
  const next = buffer.place({ x: 100.45, y: 100.2, width: 192, height: 208 });
  assert.deepEqual(next.hostBounds, first.hostBounds);
  assert.equal(next.recentered, false);
  assert.equal(next.localX - first.localX, 0.45);
  assert.equal(next.localY - first.localY, 0.2);
});
```

- [ ] **Step 2: 运行新增测试并确认模块不存在**

Run: `node --test test/render-buffer.test.js`

Expected: FAIL，模块无法加载。

- [ ] **Step 3: 实现渲染缓冲协调器**

渲染宿主边界为人物当前尺寸加两侧 `margin`。人物处于安全内区时保持 `hostBounds` 不变，仅输出小数 `localX/localY`；离开安全内区或拖拽时重新以人物为中心建立宿主边界。

- [ ] **Step 4: 接入渲染器子像素移动**

`pet-renderer.js` 创建 `.pet-stage` 包裹 `.pet-sprite`，偏移事件只修改 stage：

```js
stage.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
```

镜像仍只应用在 `.pet-sprite`，避免覆盖 stage 位移。`pet.css` 为 stage 添加 `position: absolute; left: 0; top: 0; will-change: transform;`。

- [ ] **Step 5: 统一命中与气泡全局坐标**

`main.js` 不再用 `petWindow.getBounds()` 作为人物矩形。命中窗口、脸部盒子、气泡和显示器选择全部使用 `controller.snapshot().body`，再叠加当前帧局部盒子和缩放。

- [ ] **Step 6: 运行平滑渲染测试**

Run: `node --test test/render-buffer.test.js test/pet-renderer.test.js test/pet-controller.test.js test/bubble-placement.test.js`

Expected: 全部 PASS。

- [ ] **Step 7: 第二阶段完整回归并提交**

Run: `npm test`

Expected: 全部测试 PASS。

```powershell
git add src/runtime/render-buffer.js src/main.js src/preload.js src/render/pet-renderer.js src/render/pet.css test/render-buffer.test.js test/pet-renderer.test.js test/bubble-placement.test.js
git commit -m "perf: add subpixel desktop pet rendering"
```

---

### Task 7: 真实桌面验收、评审与安装包

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Generate: `dist/Person-Desktop-Pet-Setup-1.1.0-x64.exe`
- Copy after verification: `release/Person-Desktop-Pet-Setup-1.1.0-x64.exe`

**Interfaces:**
- Consumes: 第一、第二阶段全部测试和真实桌面验收结果。
- Produces: Windows 10/11 x64 NSIS 安装包 1.1.0、SHA-256、更新后的使用说明。

- [ ] **Step 1: 运行完整自动化测试**

Run: `npm test`

Expected: 全部测试 PASS，`0` 项失败。

- [ ] **Step 2: 运行源程序真实交互验收**

使用 `npm start` 启动未打包版本并逐项记录：20 次左键拖拽、20 次右键菜单、移动中点击、窗口位于人物后方时点击、最大化/全屏进入后台与恢复、双窗口夹缝攀爬、支撑关闭/最小化/移动后掉落、语音、跪下、休息、缩放和粉色气泡。

Expected: 规格中的所有 Windows 真实桌面验收项通过。

- [ ] **Step 3: 运行 10 分钟流畅度观察**

记录视觉帧间隔、原生人物窗口重定位次数、窗口枚举次数和进程内存。确认无持续增长、坐标漂移、点击错位和反复转向。

- [ ] **Step 4: 执行独立代码评审和安全扫描**

使用 `superpowers:requesting-code-review` 检查规格覆盖、状态恢复、窗口句柄生命周期和多显示器坐标；执行项目可用的代码与密钥扫描。发现高优先级问题时返回对应任务修复并重新运行测试。

- [ ] **Step 5: 更新版本与 README**

将 `package.json` 版本改为 `1.1.0`。README 增加最大化/全屏后台行为、斜向与窗口攀爬脱困、流畅度优化和新版安装包名称，保留决斗延期说明。

- [ ] **Step 6: 构建并验证安装包**

Run:

```powershell
npm run build:win:x64
Get-FileHash 'dist/Person-Desktop-Pet-Setup-1.1.0-x64.exe' -Algorithm SHA256
```

Expected: 构建成功并输出非空 SHA-256。先安装到测试目录并重复关键点击、后台恢复与脱困冒烟测试，通过后才复制到 `release/`。

- [ ] **Step 7: 提交发布内容**

提交前再次向用户确认；不得使用 `--no-verify`，不得 force push。

```powershell
git add package.json README.md release/Person-Desktop-Pet-Setup-1.1.0-x64.exe
git commit -m "release: package desktop pet 1.1.0"
```
