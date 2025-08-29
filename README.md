# 📖 Cloudflare Worker 博客部署说明

本项目基于 **Cloudflare Workers + KV + GitHub** 搭建博客，支持功能：

- 首页 / 文章详情 / 归档 / 标签 / 关于我 (about.md)
- Markdown 渲染
- Highlight.js 代码高亮
- 无限滚动加载
- 搜索与标签筛选
- TOC（目录生成）
- 返回顶部按钮
- 管理后台（缓存管理）

---

## 🚀 部署步骤

### 1. 准备 GitHub 仓库

1. 在 GitHub 创建一个新仓库，例如：`note-gen-sync`  

2. 在仓库中新建以下目录和文件：

   ```
   posts/         # 存放文章（Markdown 文件）
   about.md       # 个人简介
   ```

3. 将文章写在 `posts/` 文件夹下，文件名建议使用英文或日期，例如：

   ```
   posts/2025-01-hello-world.md
   posts/2025-02-cloudflare-worker.md
   ```

---

### 2. 部署 Cloudflare Worker

1. 打开 **Cloudflare Dashboard → Workers & Pages → Create Worker**  

2. 将 `workers.js` 内容复制到 Worker 编辑器中  

3. 修改以下配置项（在 `workers.js` 顶部）：

   ```js
   const github_owner = "你的 GitHub 用户名";
   const github_repo  = "你的仓库名";  // 和步骤1的仓库一致
   const site_name    = "你的博客名称";
   ```

4. 保存并部署

---

### 3. 配置 KV 存储

1. 在 Worker → **存储与绑定 → KV 命名空间** 中新建一个 KV，名称如：`BLOG_CACHE`  

2. 将其绑定到 Worker，绑定变量名必须为：

   ```
   BLOG_CACHE
   ```

---

### 4. 配置环境变量

在 Worker → **设置 → 环境变量** 中添加：

- `GITHUB_TOKEN` : GitHub API Token  
  - 作用：访问 GitHub 仓库文章  
  - 创建方式：GitHub → Settings → Developer Settings → Personal access tokens  
  - 需要勾选：`repo`（只读即可）

- `ADMIN_KEY` : 管理密钥（自定义字符串，用于后台登录）

---

### 5. 使用管理后台

访问 `https://你的域名/admin`：

- 输入 `ADMIN_KEY` 登录  
- 功能：
  - **查看缓存**：显示已缓存的文件列表  
  - **清除缓存**：清空 KV 中缓存（用于文章更新后刷新）

---

### 6. 页面说明

- `/`       → 首页（文章列表 + 标签筛选 + 搜索）
- `/?p=xxx` → 文章详情页
- `/archive` → 文章归档（按月份分类）
- `/tags`   → 标签页
- `/about`  → 关于我（读取 `about.md`）
- `/admin`  → 管理后台（缓存管理）

---

## ✍ 写文章格式

每篇文章使用 Markdown 格式，建议加上 Front Matter：

```markdown
---
tags: ["Cloudflare", "Blog", "JavaScript"]
---

# 我的第一篇博客

这里是正文内容……
```

这样标签会自动识别，并显示在标签云和文章详情中。

---

## ⚡ 注意事项

- 默认从 GitHub 仓库的 **main 分支** 拉取文件，如果是 `master` 请修改：

  ```js
  const url = `https://api.github.com/repos/${github_owner}/${github_repo}/contents/${path}?ref=main`;
  ```

  改为：

  ```js
  ...?ref=master
  ```

- 部署后第一次访问时会请求 GitHub 内容，并写入 KV 缓存，提高后续访问速度。  

- 更新文章后需在后台执行 **清除缓存** 才能立即生效。

---

## 📌 示例展示

- 首页：文章列表（支持滚动加载）
- 文章详情：Markdown 渲染 + 目录生成
- 标签页：显示所有标签
- 归档页：按年月分组文章
- 关于我：从 `about.md` 渲染
- 管理后台：缓存管理

---

✅ 至此，你的 Cloudflare Worker 博客就部署完成了！
