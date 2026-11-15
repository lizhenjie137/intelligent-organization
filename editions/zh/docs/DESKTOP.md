# Windows 桌面版与源码版

**交付状态**：已提供 Windows x64 安装包与源码，安装程序已完成构建和安装验证，下载见 [v0.1.0 发布页](https://github.com/lizhenjie137/intelligent-organization/releases/tag/v0.1.0)。以下说明对应 Electron 外壳与独立后台打包流程。

## 两种使用方式

| 方式 | 适合谁 | 需要安装什么 |
| --- | --- | --- |
| Windows x64 桌面安装版 | 直接使用小辣椒的员工和管理员 | 运行安装程序；不需要自行安装 Python、Node.js 或 npm |
| 源码网页运行 | 查看和修改 Python/网页代码 | Python 3.11+、PowerShell；首次安装依赖需要网络 |
| 从源码构建桌面安装包 | 开发桌面外壳或重新打包 | Python 3.11+、Node.js 22.12+（含 npm）、PowerShell与网络 |

两种方式使用相同的组织工作台与权限流程。桌面版将网页工作台放在独立应用窗口中，并随应用提供后台运行文件；它没有新增跨电脑访问、云端账号或远程团队部署能力。

## 安装与首次启动

中文安装包文件名为 `Xiaolajiao-zh-0.1.0-Windows-x64-Setup.exe`。运行最终提供的安装程序，按向导选择安装位置；安装完成后从开始菜单或桌面快捷方式打开小辣椒。

应用会为自己启动本机后台并自动选择本机端口，无需手动运行 PowerShell 服务，也无需打开源码版的固定端口。首次进入注册本地账号：第一个账号是管理员，之后注册的是员工。

退出桌面应用会停止由它启动的后台；它不会接管或关闭另一个源码工作空间的服务。关闭应用前先提交需要保留的表单内容。重新打开后，已经保存的账号和任务数据仍在。

## 数据位置与隔离

中文桌面版默认保存到：

```text
%LOCALAPPDATA%\Xiaolajiao\zh\workspace
```

同级 `profile` 保存应用浏览器配置，`logs` 保存桌面运行日志。英文桌面版使用 `en` 子目录。源码版使用源码目录下的 `data/workspace/`。

**中文桌面版、英文桌面版、源码版及电脑上已有的工作空间彼此独立，不会自动复制账号、密码、模型设置、附件或任务。** 桌面版首次出现注册页是新空间的正常行为，不代表旧账号丢失。当前不提供自动迁移向导。

退出应用后备份对应的完整 `workspace` 目录，避免只复制数据库而遗漏附件。模型密钥由 Windows 保护，换电脑或系统账号后可能需要重新填写。安装程序配置为卸载时不自动删除用户数据；仍应在升级、卸载或手动清理前独立备份。

## 从源码构建

在源码包根目录执行：

```powershell
.\Build-Desktop.ps1
```

脚本依次完成以下操作：

1. 创建 `build/.venv`，安装锁定的运行依赖与 PyInstaller 构建依赖。
2. 通过官方 npm registry 执行 `npm ci --ignore-scripts`。
3. 从官方 Electron 发布源下载并验证固定版本运行文件。
4. 运行 `scripts/build_backend.py` 打包后台。
5. 通过 electron-builder 构建 Windows x64 NSIS 安装程序，使用 `--publish never`，不会上传。

预期输出位于 `dist/`。只有在依赖与构建环境已经准备完成时，才使用：

```powershell
.\Build-Desktop.ps1 -SkipDependencyInstall
```

当前固定版本见 `package-lock.json`、`desktop/requirements-build.txt` 和 `deepseek-harness-base/requirements.lock.txt`；桌面外壳依赖 Electron 45.3.2 与 electron-builder 26.18.0。构建脚本不复制既有业务数据到安装包。

## 开发与排查

后台打包完成、桌面依赖已安装后，可在源码目录运行 `npm run desktop:dev`。桌面窗口仍使用自己的桌面数据目录；不要把它当成源码网页空间的数据迁移工具。

启动失败时，可查看 `%LOCALAPPDATA%\Xiaolajiao\zh\logs\desktop.log`。日志可能包含本机错误上下文，公开提交问题前请先检查个人路径或敏感信息。桌面版不会自动转用已占用的源码服务。

开发测试命令见 [README](../README.md)。版本更新、迁移和签名状态以实际发布说明为准，不承诺自动更新。使用、修改和分发须遵守 [LICENSE](../LICENSE) 与 [LICENSING.md](../LICENSING.md)。
