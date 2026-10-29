# Cloudflare 版本恢复说明

恢复日期：2026-10-28。代码位于 `D:\开发项目\marchcenter`。

后续 2026-10-29 的改进和 554 项最终测试结果见 [IMPROVEMENTS.md](IMPROVEMENTS.md)。下文的 497 项记录是恢复完成时的基线验证。

## 来源与可核实范围

基础源码是 GitHub `vguangshen/marchcenter-cloudflare-d1` 的 `main` 提交
`17ef4afdc8aac08c8dcf022d52c910dd834860e7`。恢复参照为 Cloudflare 生产
Worker `f6dd2835-58ca-4614-83d1-c343ae47c938` 所服务的前端产物。

原始线上前端备份在 `.deploy-backups/cloudflare-f6dd2835/dist`，45 个文件的
来源、大小和 SHA256 见同目录上层的 `manifest.json`。完成恢复时重新检查了生产
首页，仍与该备份一致。另对全部线上 JS 与恢复源码的 API 调用路径进行了 AST
比对，已见路径均有对应实现。

这是一份可以构建、具有前后端实现的恢复工程。线上压缩前的 JSX/source map
以及实际部署的 Worker 后端文件没有取回，因此它不等同于原始源码的逐字复原，
也不能据 API 路径相同断言所有内部实现完全一致。新增服务端逻辑和数据库结构
依据已见前端接口契约重建；相应位置与本说明明确保留这一来源区别。

## 已恢复的功能

- 共用 `mc-*` 控件、弹窗及主题变量；智能体模块的 16 种主题与滚动区域。
- 软件平台云端增删改、旧浏览器平台配置导入、目录缓存、强制刷新与数据库回退。
- 智能体任务批量导入、答题类型保留、重复任务处理及封面缓存被拒绝时的降级提示。
- 个人资料窗口、头像上传/移除、主动验证当前密码后改密；保留管理员重置后的改密提醒。
- 国内 AMap 动态地图、海外 OpenStreetMap 地图及对应外部地图链接。
- 权限时间批量应用/清空、只更新选中任务、多时长快捷操作及触摸长按菜单。
- 创建账号与保存权限/时间规则在同一事务完成；显式空权限不会继承成全部权限。
- 竞赛卡片的教师/学生入口触摸长按、后续点击抑制、外部点击/Escape 关闭及菜单层级。
- 操作窗口加载提示，以及软件平台名称/主题/排序与相关界面的接线。

## 登录按钮修复

`src/index.css` 的 `.login-auth-submit` 增加：

```css
background-origin: border-box;
background-repeat: no-repeat;
```

登录按钮同时采用线上 `mc-button` 样式体系。渐变覆盖透明边框区域且不重复，
从而消除左右两侧重复绘制的细线，保留主题本身有意设置的边框。

本地生产构建的实际页面已在 Chrome 日间/夜间模式检查，计算样式均为
`border-box` / `no-repeat`。截图在
`.deploy-backups/recovery-verification/login-desktop.jpg` 和 `login-night.jpg`。
这是独立本地测试环境，不是修改后的公网部署。

## 配置与数据库

新数据库依次应用 `migrations/` 下的迁移即可使用恢复后的功能。新增迁移：

- `0035_paas_v2_platforms_catalog.sql`：平台元数据与目录缓存。
- `0040_user_profile_avatar.sql`：用户头像。

生产 Cloudflare 数据库的实际结构没有导出核对，所以本轮没有对其执行这些迁移。
现有线上表是否与重建结构一致，需要在发布到该数据库前单独核实。

动态国内地图配置使用 `.dev.vars.example` 中的 `AMAP_WEB_KEY` 和
`AMAP_SERVICE_HOST`。这两个环境变量名是恢复工程的选择，并非声称取得了线上
原配置名。Web Key 为前端公开 Key；私有安全码应由配置的安全代理处理。
不配置地图服务时保留加载失败提示及外部地图入口。

工程不包含生产 Secrets、D1/R2 业务数据或账号登录状态。

## 验证与运行

使用项目锁文件安装依赖后：

```sh
npm ci
npm run build
npm run check
npm test
```

`npm test` 包含恢复功能的前端语义测试、官方兼容层测试、真实 Worker/D1 本地
端到端测试及原项目验证脚本。恢复过程中的完整日志保存在
`.deploy-backups/recovery-build.log`、`recovery-check.log`、`recovery-test.log`。

测试中的远程平台请求使用本地 mock；没有为验证而修改生产账号或数据。
本轮仅修改本地代码，没有 push 到 GitHub 或重新部署 Cloudflare。

最终结果：`npm run build`、`npm run check`、`npm test` 均成功；前端/头像
9 项、官方兼容层 340 项、端到端 148 项，共 497 项测试全部通过，后续 6 组
项目校验脚本也全部通过。卡片旧层级断言已补入教师菜单条件；Windows 测试
夹具读取 CSP 时会移除 CRLF 行结束符，CSP 与壁纸加载的原有断言保持不变。
