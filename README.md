# MarchCenter — Cloudflare Workers + D1

本版本已经从传统 Node.js/Express + MySQL 服务器迁移为：

- Cloudflare Workers：后端 API
- Workers Static Assets：React/Vite 前端
- Cloudflare D1：业务数据库
- Wrangler migrations：数据库结构管理

旧版“执行自定义 JavaScript 脚本”的 SSO 功能已彻底移除。系统现在内置 **8 种受支持的接入方式**（全部为官方 `itmc-tool-train-1.7.3.jar` 适配器的一一对应实现）：

| 接入方式 | 传输协议 | 官方服务类 | 证据等级 |
|---|---|---|---|
| `java` | HTTP form（`/open` REST） | `NewTrainingInterfaceUtilService` | official-captured |
| `net` | SOAP 1.1 / Axis | `NetGeneralStandardInterfaceUtilService` | official-captured |
| `marketing` | SOAP 1.1 / Axis | `ShichangyingxiaoshapanInterfaceUtilService` | official-captured |
| `commerce` | SOAP 1.1 / Axis | `WangdianyunyingtuiguangGJshapanInterfaceUtilService` | official-captured |
| `managementAccounting` | SOAP 1.1 / Axis | `GuanlikuaijiGJshapanInterfaceUtilService` | official-captured |
| `crossBorderCommerce` | SOAP 1.1 / Axis | `KuajingdianshangshapanInterfaceUtilService` | official-captured |
| `enterpriseManagement` | SOAP 1.1 / Axis | `QiyeguanlishapanInterfaceUtilService` | official-captured |
| `direct` | 浏览器跳转 | （URL 原样返回） | official-static-derived |

## 官方兼容层（official-compat）

所有跳转统一走 `official-compat` 执行器，行为与官方 `TrainingEntrance` 对齐：

- 每次跳转都执行官方远端班级/账号检查，不读取本地“已就绪”快捷路径；
- `common*` 方法白名单 + 10011 整方法重试（最多 3 次）并清除 `url/open` token 缓存；
- JAVA token 缓存 1 小时、获取最多 3 次；
- SOAP wire 与 Axis 1.4 一致：SOAPAction、`clientinfo` 头、null 数组省略、bean 字段顺序；
- 登录票据（`GetRegisterCode`：MD5 → DES/CBC/PKCS5）与官方逐字节一致；
- SSRF 防护：精确 host/port/context 校验、禁止重定向、响应字节上限；
- 错误日志结构化脱敏，不记录凭据、请求体与票据。

黄金样本：`tests/official-parity/` 下所有 profile 的请求 XML 均与官方 Axis Stub 的 loopback 捕获**逐字节一致**（`static-derived-captures.test.mjs`、`marketing-add-student-contract.test.mjs` 等）。捕获工具为 `tests/official-parity/soap-business/capture/` 下的 Java 程序，需要官方 JAR + Virbox agent 才能重新生成。

## 已实现范围与缺口

- 已实现的核心 `common*` 方法：`commonReturnTargetId`、`commonGetLoginName`、`commonCheckTrain`、`commonCheckTrainWithTeacher`、`commonReturnStudentBaseInfo`、`commonReturnTeacherBaseInfo`（覆盖登录跳转、建班建号、票据签发）。
- 远程删除班级：`.NET/沙盘类 SOAP` 走 `IsGroupExisted + DelGroup`；`JAVA` 走**账号管理 API 直删数据库**（通用原语 `POST /api/v1/db/delete`：执行端按 MarchCenter 编排的参数化删行操作，`DELETE FROM 班级表 WHERE 班级名列 = 班级名`，`dryRun` 可预览）。JAVA 不再使用 v3 删除密钥模块（v3 删班在真实平台不可用），也不再走 v1 open-API 组合（`markGroupDeleted` 在部分平台 302、`checkClassName` 在部分平台按 `uc_mode=5` 过滤导致班级不可见）。**卡片在编辑中（仅当 SSO 方式为 JAVA 接口时显示）配置"Java 班级删除映射"：选择账号管理 API 服务器 → 数据库 → 班级表 → 班级名列**，未配置时长按删除班级返回 409。长按删除进度条 JAVA 平台为蓝色、.NET/SOAP 为红色。
- 尚未实现的官方 `common*` 管理方法（18 个）：成绩/标签分查询（`commonGetExamPaperScore`、`commonGetTheoreticalScore`、`commonGetStudentTagNameScore*`）、报告与任务汇总（`commonGetTrainReport`、`commonGetTaskCollect`）、重置（`commonResetExamineData`、`commonResetEndExamTime`）、在线数（`commonGetOnlineCount`）、删除/换卷/备份（`commonMarkStudentDeleted`、`commonChangePaper`、`commonStartBackup*` 等）。
- 官方 JAR 中的 20 个旧版适配器（`service.impl`，旧 `ITrainingServiceInterface` 契约）未注册，仅保留取证记录。
- canary 灰度框架（`server/utils/officialCompat/canary/`）已就绪，未接入生产路由，用于将来对真实厂商平台做受控上线验证。

## 1. 安装依赖

```bash
npm install
```

## 2. 登录 Cloudflare

```bash
npx wrangler login
```

## 3. 创建 D1 数据库

```bash
npm run db:create
```

命令会返回一个 `database_id`。将它填入 `wrangler.jsonc`：

```json
"database_id": "这里替换为真实的 D1 UUID"
```

## 4. 创建数据库表

```bash
npm run db:migrate:remote
```

## 5. 配置生产 Secrets

至少配置下面三个值，而且三者不要相同：

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put SSO_CONFIG_ENCRYPTION_KEY
npx wrangler secret put INITIAL_ADMIN_BOOTSTRAP_SECRET
```

生成随机值可以使用：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

JAVA 接口需要全局默认 Token 时，可继续配置：

```bash
npx wrangler secret put ITMC_PLATFORM_TOKEN_NUMBER
npx wrangler secret put ITMC_PLATFORM_TOKEN_PASSWORD
```

六个 SOAP 沙盘（net、marketing、commerce、managementAccounting、crossBorderCommerce、enterpriseManagement）需要全局 SOAP 凭据时，可配置：

```bash
npx wrangler secret put SOAP_CLIENT_USERNAME
npx wrangler secret put SOAP_CLIENT_PASSWORD
npx wrangler secret put SOAP_STUDENT_INITIAL_PASSWORD
```

也可以在后台“免密登录配置”页按接入方式保存凭据；这些字段会使用 `SSO_CONFIG_ENCRYPTION_KEY` 加密后写入 D1，浏览器读取配置时不会返回密钥原文（管理员可点击“显示”按需解密查看）。

## 6. 修改域名设置

编辑 `wrangler.jsonc` 中的：

```json
"CORS_ORIGINS": "https://你的域名"
```

前端和 API 默认由同一个 Worker 提供，因此前端仍然使用 `/api` 相对路径。

## 7. 部署

```bash
npm run cf:deploy
```

部署完成后访问 Wrangler 输出的 `workers.dev` 地址，或在 Cloudflare 控制台为 Worker 添加自定义域名。

## 8. 首次初始化

空数据库首次打开时，可以注册第一个 `super_admin`，但必须同时填写由部署者配置的 `INITIAL_ADMIN_BOOTSTRAP_SECRET`。初始化成功后该入口永久关闭；后续账号必须由上级账号在用户管理中创建。建议初始化完成后更换或删除这条 Worker Secret，数据库中的初始化锁仍会阻止再次抢占首个管理员。

## 本地开发

复制本地变量模板：

```bash
cp .dev.vars.example .dev.vars
```

填写至少 `JWT_SECRET`、`SSO_CONFIG_ENCRYPTION_KEY` 和 `INITIAL_ADMIN_BOOTSTRAP_SECRET`，然后执行：

```bash
npm run db:migrate:local
npm run cf:dev
```

默认地址通常为 `http://localhost:8787`。

## 测试

```bash
npm test
```

测试覆盖官方兼容层（300+ 用例：票据、重试、token、SOAP wire、业务分支、e2e 生产路由）以及账号、壁纸、邮件、注册、平台加固等模块。

## 数据备份

后台数据库页面可以下载适合小型数据库的“数据 SQL 备份”。恢复时要先执行 migration，再导入备份。

完整远程备份建议使用 Wrangler：

```bash
npm run db:export:remote
```

恢复示例：

```bash
npx wrangler d1 execute DB --remote --file marchcenter-d1-backup.sql
```

## 上线前检查

```bash
npm run check
npm run build
npx wrangler deploy --dry-run
```

## 重要说明

- 原压缩包中没有可直接导入的 MySQL 数据库 dump，因此本项目附带的是空 D1 schema，不包含原数据库中的业务数据。
- `java` 适配器调用厂商公开 HTTP 接口，不依赖 Java/JAR/本地进程；六个 SOAP 适配器内置 Axis 契约与黄金样本。
- 目标平台必须能被 Cloudflare 边缘节点通过公网访问。仅局域网可访问的地址无法直接调用。
- 默认仅允许 HTTPS 平台地址。确实需要旧平台 HTTP 时，在对应免密配置中勾选“允许 HTTP 平台”；该权限只作用于这一份配置，不会全局放开其他平台。
- 旧版数据库可编辑 SOAP 工作流、相关接口和表结构已经移除；所有接入方式仅使用代码内置且可测试的固定适配器。
