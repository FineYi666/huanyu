<div align="center">

# 幻屿 · HUANYU

**你的私人放映室 —— 一款运行于 Windows 的本地影视 + 游戏管理软件**

[![Version](https://img.shields.io/badge/version-1.3.0-blue)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](../../releases)
[![Electron](https://img.shields.io/badge/Electron-45-47848F)](https://www.electronjs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**季度新番 · 动漫 · 电影 · 本地游戏 · 全部收藏在你自己的电脑上**

[下载安装包](../../releases/latest) · [便携版](../../releases/latest) · [功能介绍](#-功能特性) · [截图](#-截图预览)

![首页](docs/screenshots/home.png)

</div>

## ✨ 功能特性

### 📺 季度新番
- 自动获取 **Bangumi 当季新番片单**，评分、开播时间、简介一站直达
- 内置 **历史季度存档**：近 4 年的任意季度（如 2025 年 10 月新番）随时回看
- 顶部搜索框横跨 **2023 年 1 月开播至今的全部新番**，跨季度一键查找
- 高分新番轮播 banner，一键查找夸克网盘资源 / 关联本地视频

### 🎬 影视库与播放
- 导入本地视频（自动整理分集）或 **夸克网盘分享链接**，在线播放无需下载
- 原画 / 4K / 2K 多档画质自动选择，HLS 流媒体代理播放
- 内外挂字幕：自动搜索匹配字幕、内嵌字幕提取、字幕样式自定义
- 观看进度、收藏、继续观看一一记录，全部保存在本机

### 🎮 游戏空间
- 导入本机游戏（`.exe` 或 `.lnk` 快捷方式），点击封面即可启动
- 自动从 Steam 获取封面与中文简介（可手动上传 / 编辑）
- 游玩次数、最近游玩时间记录，最近玩过的排最前
- 游戏文件保留原位，仅记录启动路径

### 🎨 七款场景皮肤
晨雾青屿 · 蓝金流光 · 赤焰终端 · 翡翠幻墨 · 霓虹夜城 · 鎏金影厅 · 冰雪之境

每套皮肤均配全屏场景背景、主题化滚动条与液态玻璃质感，明暗两种氛围随意切换。

![皮肤](docs/screenshots/skins.png)

### 🎮 游戏空间一览
![游戏空间](docs/screenshots/games.png)

### 🔒 隐私优先
- 所有数据（媒体库、收藏、进度、游戏、密钥）**只保存在本机**，无任何遥测与上传
- 密钥经 Windows 当前用户加密存储（DPAPI）
- 卸载软件不会删除你的媒体库数据

## 📥 下载

前往 [Releases](../../releases/latest) 页面：

| 文件 | 说明 |
| --- | --- |
| `幻屿-1.3.0-安装程序.exe` | 标准安装向导：选择目录 → 安装 → 完成，含桌面快捷方式与卸载器 |
| `幻屿-1.3.0-便携版.zip` | 免安装便携版：解压后运行 `幻屿.exe` 即可 |

> 💡 安装 / 运行时若提示软件未知，选择「仍要运行」即可（个人项目未做代码签名）。

## 🚀 快速开始

1. 下载并安装（或解压便携版）
2. 启动幻屿 —— 服务与界面自动就绪
3. 顶部「导入资源」添加你的本地视频 / 夸克分享，「游戏」页导入本机游戏
4. 在「设置」中按需绑定 DeepSeek Key（AI 自动补全封面简介，可选）与夸克账号（在线播放）

## 🛠 技术栈

- **前端**：React 19 + Vite + TypeScript，无 UI 框架、手写 CSS 主题系统
- **后端**：Node.js 原生 `http` 模块（无框架），媒体流 Range 分发、HLS 代理
- **桌面**：Electron 45（自绘标题栏 + 主题化窗口按钮）
- **数据**：本地 JSON + 文件系统，原子写入
- **测试**：Node.js 内置 test runner，70 个自动化用例

```powershell
npm install        # 安装依赖
npm run dev        # 开发模式（前端热更新）
npm run build      # 构建前端
npm test           # 运行测试
npm run typecheck  # 类型检查
```

## ⚠️ 免责声明

- 本项目仅供学习与个人使用。夸克网盘相关功能基于其网页端公开接口，请遵守服务条款；播放质量与可用性取决于账号权限。
- 新番资料与海报来自 [Bangumi](https://bgm.tv) 公开接口，版权归原权利方所有。
- 请勿将本软件用于任何商业用途。

## 📄 License

[MIT](LICENSE)
