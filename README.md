# 小幺鸡接口文档自动抓取

> Tampermonkey 油猴脚本，一键抓取 [小幺鸡](https://www.xiaoyaoji.cn) 项目所有接口数据，导出为 **OpenAPI 3.0 (Apifox)** 和 **Markdown** 文档。

## ⚡ 一键安装

[![安装脚本](https://img.shields.io/badge/Tampermonkey-安装脚本-orange?style=for-the-badge)](https://raw.githubusercontent.com/Amhertx/xiaoyaoji-api-scraper/master/%E5%B0%8F%E5%B9%BA%E9%B8%A1%E6%8E%A5%E5%8F%A3%E6%96%87%E6%A1%A3%E6%8A%93%E5%8F%96.js)

> 💡 需要先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展

## 功能特性

- 🔍 自动发现页面中的所有接口
- 🖱️ 批量点击接口链接并拦截 XHR 数据
- 📂 自动识别文件夹分类
- 📄 导出 **OpenAPI 3.0 JSON**（可直接导入 Apifox / Swagger / Postman）
- 📝 导出 **Markdown** 格式接口文档

## 使用方法

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 点击上方「安装脚本」按钮
3. 打开小幺鸡项目页面（`https://www.xiaoyaoji.cn/project/...`）
4. 点击页面中的「开始采集」按钮
5. 等待完成后自动下载两个文件：
   - `apifox_import_*.json` — Apifox/Swagger 导入文件
   - `api_doc_*.md` — Markdown 接口文档

## License

MIT
