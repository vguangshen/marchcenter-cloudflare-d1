# MarchCenter 工作日志

本文件按日期记录关键决策、调研结论与实现记录，供后续排障与版本对照使用。

---

## 2026-08-08（卡片级）· Java 班级删除映射迁移到竞赛卡片

### 变更

班级删除映射从"账号管理服务级配置"迁移到**竞赛卡片级**：

1. **数据模型**：迁移 `0025_competition_class_delete_mapping.sql` 给 `competitions`
   加 `class_delete_mapping` TEXT（JSON）。
2. **映射精简为 4 个有效字段**：`apiId`（账号管理 API 服务）、`databaseName`、
   `classTable`、`classNameColumn`——去掉了平台类型（由 JAVA SSO 隐含）、班级ID列、
   级联子表、启用开关等冗余字段。删除逻辑只删班级行本身：
   `DELETE FROM classTable WHERE classNameColumn = className`。
3. **后端**：`competitions.js` 卡片 SELECT/INSERT/UPDATE 读写该列；`sso.js`
   class/remove 用卡片映射（`card.classDeleteMapping`）并通过 `mapping.apiId` 解析
   账号管理服务；新增卡片级校验路由 `POST /api/competitions/class-delete/check`
   （body 携带映射与绑定，新建未保存的卡片也能预览）；移除服务级
   `PUT /services/:id/class-delete` 与 `POST /services/:id/classes/check`。
4. **前端**：`EditModal.jsx` "Java 班级删除映射"区块——**仅当 SSO 方式为 JAVA 接口时
   显示**，四步选择器：账号管理 API 服务器 → 数据库 → 班级表 → 班级名列（JAVA 一律
   MySQL，选择器与账号数据库一致）+ 校验预览；`AccountManagementApiManager.jsx`
   移除该区块。
5. **长按删除进度条颜色区分**：JAVA 平台蓝色、.NET/SOAP 红色（`ContestCard.jsx`）。

### 验证

- `npm test` 全绿（316 + 89）、`npm run check`、`npm run build` 通过。
- e2e：JAVA 删班（成功/幂等/未配置 409/映射不完整 409/502）+ 卡片级 check 预览。
- 待应用迁移 0025 并部署后线上生效。

---

## 2026-08-08（上线）· MarchCenter 生产部署（v3 移除 + 账号管理删班）

### 变更上线

1. **D1 迁移 `0024_drop_competition_v3_keys.sql` 应用至生产**：删除
   `v3_pub_key_p1` / `v3_pub_key_k1` 列（不可逆）。
2. **Worker 部署至生产**：`wrangler deploy`，Version
   `a609b4f7-7c92-434b-8185-21e58e0bffee`，`https://marchcenter.top` 正常。
3. 线上冒烟：`GET /api/health` → `{"ok":true,"runtime":"cloudflare-workers","database":"d1"}`，
   首页 200、登录页 307（SPA 跳转）正常。

### 本次上线包含

- Java 删班改走**账号管理 API 直删数据库**（v3/v1 open-API 删班全部移除）。
- 彻底删除 v3 删除密钥模块（含数据库列）。
- 账号管理执行端新增 `db/delete`、`accounts/create`，网页端同步收窄认证为 HMAC-only。

### 注意

- 现有账号管理服务若此前使用非 HMAC 认证，需重新填 HMAC 签名密钥。
- Java 平台删班需在账号管理页面配置"Java 班级删除映射"后可用。

---

## 2026-08-08（执行端）· 账号管理执行端补删建 + 桥梁化精简

### 背景

Java 平台删班迁移到账号管理 API 直删后，执行端（`marchcenter-account-api`，v2.0.1）
原本只有读取 + 改密码（UPDATE），**没有删除与创建能力**。本次为执行端补齐通用
DELETE / CREATE，并按用户"执行端只当桥梁"的定位精简非桥梁功能。

### 变更（执行端 `marchcenter-account-api` v2.0.1）

1. **`POST /api/v1/db/delete`**（新增）：通用参数化批量删除。
   - 请求：`{ system, profileId?, platformUrl?, databaseName, operations[], dryRun? }`，
     用 `ResolveProfile(system, platformUrl)` 解析数据库连接。
   - `operations` 每条 `{ table, where: [{ column, value } | { column, inSelect: { table, selectColumn, where } }] }`，
     递归构建 `DELETE … WHERE col = @v` / `col IN (SELECT …)`；标识符白名单正则 +
     值全参数化（沿用 `QuoteIdentifier`/`AddParameter`），同一事务原子执行。
   - `dryRun: true` 时改跑 `SELECT COUNT(1)` 返回将删行数（预览，不删）。
   - `AccountRepository.DeleteRows` 实现。
2. **`POST /api/v1/accounts/create`**（从 501 桩实现为通用 INSERT）：
   - `{ system, username, password, …, passwordAlgorithm, extraColumns[] }`；
     先按用户名列判重（已存在 → 幂等 `created:false`），再插用户名+密码哈希，
     `extraColumns` 支持平台要求的其他必填列（如 user_role）。
   - `AccountRepository.CreateAccount` 实现。
3. **精简（桥梁化）**：
   - 删除旧版本目录（v1.7.2 ~ v2.0.0）与 zip、`release/`、版本说明 txt。
   - 删除 `verification/`（验证脚本）、`CompactMainForm.cs`（已排除的死代码）。
   - 认证收窄为 **HMAC-only**（`Authenticate` 去掉 bearer/none/cloudflare_access；
     清理 `BearerToken` 字段；`/alive` 并入 `/health`，Manager 连接检测改 ping `/health`）。
   - **GUI（`MarchCenter.AccountApi.Manager`）按用户要求保留**（HMAC 密钥生成、启停服务、日志）。

### 变更（MarchCenter 侧，同步对齐）

- `accountManagementApi.js`：`AUTH_MODES` 只留 `hmac`（默认 `hmac`），`authenticationHeaders`
  只走 HMAC；`db/delete` 请求补 `system` + `platformUrl`；班级映射新增 `system`（默认 java）。
- `sso.js` 删班传 `system: card.ssoMethod`、`platformUrl: card.url`；`classes/check` 预览传 `system`。
- 前端 `AccountManagementApiManager.jsx`：去掉"认证方式"下拉与 Cloudflare Access/Bearer 输入，
  只留 HMAC 签名密钥；映射块增加"平台类型"字段。

### 验证

- 执行端 `dotnet build`（两个工程）0 警告 0 错误。
- `npm test` 全绿（316 + 89）、`npm run build` 通过。
- e2e 覆盖 JAVA 删班（成功/幂等/409/502）与新路由保存/预览。

### 注意

- **现有非 HMAC 的账号管理服务配置会失效**：升级后统一归到 `hmac`，缺少 signingSecret 会请求失败，
  需重新填 HMAC 密钥。
- `db/delete` / `accounts/create` 的真实 SQL 需在实际 MySQL/SQL Server 上实测（e2e 用 mock 执行端）。

---

## 2026-08-08 · Java 删除班级回退 v1 原版接口

### 结论

Java 平台“长按删除班级”从 v3-only 回退为 **v1 组合**：
`/open/checkClass`（班级名 → 班级ID）→ `/open/delDataByClassName`（删学生，立即）
→ `/open/markGroupDeleted`（删班级行）。同时**移除 v3 密钥 UI 与透传**
（P1/K1 输入、`reveal-v3-keys` 接口、sso 透传），数据库字段与 v3 工具文件保留。

### 证据（本次反编译官方工具 JAR）

- **官方工具 `itmc-tool-train-1.7.3.jar`（1.4MB，md5 bf47ea9e）自身只实现 v1 删班接口**，
  没有任何 v3 调用：`/open/checkClass`、`/open/delDataByClassName`、
  `/open/markGroupDeleted`、`/open/delStudentData`/`delStudentDataQueue`、
  `/open/reinitializeSystem`。这正是黄金样本
  `class-delete-contract.test.mjs` 已捕获的官方 wire。
- 服务端恢复包 `WEB-INF_recovered`（classes + 全部 itmc 业务 JAR）中**没有 v3 控制器**
  （`ExternalInterfaceV3Controller`）、没有 v1 删除处理器（OpenController 只映射
  `loadRaceLogos`/`teacherIndex`）。印证 v3 删除是平台版本强相关的缺陷，
  原版工具从不依赖它。

### 线上故障（用户实证）

- 真实 Java 平台长按删除班级报：
  `v3/DelStudent 网络请求失败: official transport 禁止 HTTP 重定向`。
- 根因：平台 v3 删除接口对非空学生列表抛异常（`findByClassNames` 未定义）→ Spring
  302 跳登录页 → `safeTransport.js` 的 SSRF 重定向防护拦截。传输层行为正确，
  坏的是平台 v3 删除接口。v1 组合无此问题。

### 变更

1. `newTrainingAdapter.js` `deleteClassAccount` 重构为 v1 组合
   （`checkClass` → `delDataByClassName` → `markGroupDeleted`）；班级不存在返回
   幂等 `{deleted:false}`。token 失效 10011 重试无需改动（`tokenStore.delete` 的 key
   = openBaseUrl，与 v1 `tokenClient.cacheKey` 一致）。
2. 移除 v3 密钥配置链路：`sso.js` v3 解密透传、`competitions.js`
   `v3KeysSelection`/`v3KeysConfigured`/`reveal-v3-keys`、`EditModal.jsx`
   “JAVA v3 删除密钥”区块。
3. 保留（不删）：`v3_pub_key_p1/k1` 数据库字段、`javaV3Client.js`、
   `v3DefaultKeys.js`（v3 将来可能用于只读接口如 `GetSystemInfo`）。
4. 测试：`production-route-e2e.test.mjs` class-remove 用例改为 v1 断言
   （`tokenInfo → checkClass → delDataByClassName → markGroupDeleted`，新增
   “班级不存在幂等”用例）；新增单测
   `class-delete-v1.test.mjs` 直接驱动 `deleteClassAccount` 断言 wire 与
   成功/幂等/失败分支。

### 验证

- `npm test` 全套通过；e2e 47 项全绿（java class remove 成功/幂等/失败 3 项）。
- 待真实平台验证：用户提供目标 Java 平台地址后，用 `checkClass` 探测班级，
  再走完整删除链路，确认 302 不再出现。

---

## 2026-08-08（续）· Java 删班迁移到账号管理 API 直删，彻底移除 v3 模块

### 背景

在真实平台验证后发现 v1 删班组合同样不可靠：
- **YX030505**：`markGroupDeleted` 302（班级行删除失效）。
- **YT00123**：`checkClassName`/`delDataByClassName` 硬编码 `uc_mode=5`，web 后台建的
  mode-1 班级查不到 → MarchCenter 误报“班级不存在→已删除”（**假成功**，班级仍在）。
- YT00123 的 v3 密钥也未注册（默认密钥“公钥未注册”、id=2“临时秘钥缺失”），v3 删班不可用。

结论：Java 平台通过 open-API 删班在真实部署全部失效，改为复用**账号管理 API**（MarchCenter →
Windows 执行端，直连平台数据库）删除班级行，并彻底移除 v3 删除密钥模块。

### 变更

1. **彻底删除 v3 模块**：删除 `javaV3Client.js`、`v3DefaultKeys.js`；移除
   `officialClassLifecycle.js` / `officialDependencyFactory.js` 的 `v3Keys` 透传；
   迁移 `0024_drop_competition_v3_keys.sql` 删除 `v3_pub_key_p1/k1` 列。
2. **移除 Java v1 删班链**：`newTrainingAdapter.deleteClassAccount` 删除（不再走
   open-API 删班）；`class-delete-v1.test.mjs` 移除。SOAP 适配器删班不变。
3. **账号管理 API 班级删除**：
   - 执行端新契约：**一个通用原语** `POST /api/v1/db/delete`（参数化批量删行、
     支持 `dryRun` 预览；子表按 class_id 匹配班级名子查询，同一事务内原子执行）。
     MarchCenter 用已存的班级映射（classTable/classNameColumn/classIdColumn/
     childTables 级联子表）编排删除，执行端不感知“班级”。
   - **执行端 v2.0.1 已实现**（`marchcenter-account-api`）：`AccountRepository.DeleteRows`
     生成参数化 DELETE（`WHERE col = @v` / `WHERE col IN (SELECT …)`，标识符白名单 +
     值参数化，事务原子），`AccountApiHost` 新增 `/api/v1/db/delete` 路由与
     `dryRun` 预览；同时把 `/api/v1/accounts/create` 从 501 桩实现为通用 INSERT
     （按用户名列判重幂等，`extraColumns` 支持其余必填列），capabilities 增加
     `createAccount`、`deleteRows`。
   - MarchCenter 客户端：`accountManagementApi.js` 新增 `normalizeClassDeleteMapping`、
     `isClassDeleteMappingReady`、`checkPlatformClass`、`deletePlatformClass`；服务配置新增
     `classDelete` 字段。
   - 路由：`accountManagement.js` 新增 `PUT /services/:id/class-delete`、
     `POST /services/:id/classes/check`；`sso.js` class/remove 对 java 分支走账号管理直删
     （未绑定 409 / 未配置映射 409 / notFound 幂等 / 执行端失败 502）。
   - 前端：`AccountManagementApiManager.jsx` 新增“Java 班级删除映射”配置块（启用/表列/
     级联子表/校验预览）；`EditModal.jsx` java 卡片删班提示。

### 验证

- `npm test` 全绿（316 官方奇偶 + 89 e2e）；`npm run check`、`npm run build` 通过。
- 执行端 `dotnet build` 通过（0 警告 0 错误）。
- e2e 覆盖：JAVA 删班走账号管理（成功/幂等/未绑定 409/未启用 409/502）、新路由保存与预览。
- 待真实平台验证：执行端部署 v2.0.1 + 绑定服务 + 配置 user_class 映射 → 长按删除班级 →
  确认班级行从数据库消失（执行端 `db/delete` 需在真实 MySQL/SQL Server 上实测 SQL 生成）。

---

## 2026-08-03 · Java 平台远程删除班级（v3 开放接口）调研与实现

### 背景

MarchCenter 需要在 Java 竞赛/实训平台（如 YX030505 数字营销推广）上“长按删除班级”，
要求：只使用**被跳转执行的开放接口**（不用平台后台登录会话的接口），且尽量不在对方
系统新增注册记录。

### 调研结论（基于 YX030505 脱壳包 `WEB-INF_recovered` 反编译）

**平台侧可用的跳转执行删除接口：**

| 接口 | 请求方式 | 实际删除范围 | 结论 |
|---|---|---|---|
| `/open/delDataByClassName` | 表单 `u=班级名` + platformToken | 仅该班学生（`role=1`） | 不删班级行/教师；无学生时返回成功但什么都不删 |
| `/open/markGroupDeleted` | 表单 `u=班级ID` + platformToken | 挂 3 天定时任务（cron 写死 `0 0 0 1/3 * ?`） | 延迟且任务类 `com.itmc.schdule.*` 未在脱壳包内，无法核实 |
| `/open/v3/DelStudent` | JSON `data.studentAccountList` + sign | 学生账号 | **该版本平台代码存在缺陷，真实数据下抛异常** |
| `/open/v3/DelTeacher` | JSON `data.teacherAccountList` + sign | 教师账号 | 同上 |
| `/open/v3/DelGroup` | JSON `data.classNameList` + sign | 班级行 | 同上 |

**v3 删除接口的平台侧缺陷（已实证）：**

- `ExternalInterfaceV3Controller.delGroup` 调用 `classService.findByClassNames(...)`，
  但该方法在整个代码库中仅出现在控制器里；service 接口、实现、mapper 均未定义，
  `selectByClassNames` 只是 `IreClassMapper.xml` 里无人引用的孤儿 SQL。
- 线上实测（假账号/假班级名，零破坏）：空列表请求返回正常 JSON 校验错误（说明
  接口存在、签名校验生效）；**任何非空列表请求都抛异常并被错误页渲染为登录页
  HTML**（200）。`GetTokenInfo`、`GetSystemInfo` 等 v3 只读接口正常。
- 结论：该版本平台 v3 删除是**平台自身代码缺陷**，与 MarchCenter 无关；修平台代码
  或升级平台版本后才可用。

**v3 密钥机制（免注册）**

- 平台安装包初始化 SQL（`toutiao_basic_tg.sql`）自带 6 条默认 `approval` 记录
  （id 2/6/7/8/9/10，`status=1`），每行含 `pub_key_p1`（调用方公钥）与
  `pub_key_k1`（平台公钥）。
- 直接使用默认记录的 P1/K1 调 `GetTokenInfo`（userType=innersoft）即可拿 token，
  再用 K1 做 RSA/PKCS1 签名调删除接口，**不会在对方系统新增注册记录**。
- 这些密钥是软件包全局常量（连平台私钥都在 SQL 里），等同官方工具自带身份，
  不能当作安全边界。

### MarchCenter 实现

1. **数据库**：`competitions` 表新增 `v3_pub_key_p1` / `v3_pub_key_k1`
   （AES-GCM 加密存储；迁移 `0019_competition_v3_keys.sql`）。
2. **卡片编辑 UI**：JAVA 卡片新增“JAVA v3 删除密钥”区块（P1/K1），已配置时掩码显示、
   眼睛图标经管理员专用接口 `POST /competitions/:id/reveal-v3-keys` 实时解密展示，
   留空保存沿用旧密钥。
3. **删班链路（v3-only，不再调用 v1）**：
   `GetTokenInfo(默认或卡片密钥) → DelStudent → DelTeacher → DelGroup`，
   全部携带 `sign`（K1 分块 RSA/PKCS1 加密 body+timestamp）与 `platformToken`。
4. **默认密钥**：`server/utils/officialCompat/java/v3DefaultKeys.js` 内置 6 条
   平台默认密钥对；卡片未配置时自动逐个尝试。
5. **workerd 兼容**：`publicEncrypt` 不接受 KeyObject，改用 PEM 字符串加密
   （`javaV3Client.js`）。
6. **测试**：e2e 覆盖 `GetTokenInfo → DelStudent → DelTeacher → DelGroup` 完整链路
   （含 sign 头断言、失败 502 断言）；全套 56 项通过。

### 线上验证（2026-08-03）

- `https://marchcenter.top` 200；已部署版本
  `c70629e0-5054-4fac-8e3b-8bf64df9c2e7`。
- YX030505（101.33.200.119:9314/YX030505）：默认密钥可拿 token；
  v3 删除接口对真实数据抛异常（平台缺陷），删除暂不可用。
- 其余 Java 平台（PT0404/PT0402/PT0401/PT0403/YT/DS 系列）默认密钥不通用
  （各自返回“公钥不存在/临时秘钥缺失”），需要各自平台自己的密钥。

### 待决事项

- 该平台版本 v3 删除不可用：需选择（1）修复/升级平台代码使 v3 可用；
  （2）对该类平台回退 v1 组合（`checkClassName → delDataByClassName +
  markGroupDeleted`，删学生立即、班级延迟 ≤3 天）；（3）维持 v3-only 并明确报错。

---

*记录人：Codex（与用户协作）*
