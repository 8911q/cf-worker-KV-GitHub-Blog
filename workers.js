/**
 * Cloudflare Worker Blog
 * 功能：支持首页、文章详情、归档、标签、关于我 (about.md)
 * 特性：Markdown 渲染 / Highlight.js / 无限滚动 / 搜索 / 标签筛选 / TOC / 返回顶部
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// ======= 配置 =======
const github_owner = "8911q";   // 改成你的 GitHub 用户名
const github_repo  = "note-gen-sync";        // 改成你的仓库名
const site_name    = "技术文章记录 Blog";

// ===== 自定义 KV 与管理密钥 =====
// 在 Cloudflare Workers Dashboard → Variables 中设置：
// - GITHUB_TOKEN: GitHub API Token
// - ADMIN_KEY: 管理密钥
// 并绑定 KV 命名空间 BLOG_CACHE


const adminKey = ADMIN_KEY;
const cache = BLOG_CACHE;

const site_desc    = "这是一个用 CloudFlare Worker + KV + GitHub 搭建的博客";
const copyright    = `&copy; 2025 ${site_name} | <a href="https://github.com/${github_owner}/" target="_blank">Github</a>`;

// Secret 在 Cloudflare Worker Dashboard 设置
const github_token = GITHUB_TOKEN;

// ======= 工具函数 =======
function getRequestParams(str) {
  let index = str.indexOf("?");
  if (index === -1) return {};
  str = str.substring(index + 1);
  return Object.fromEntries(new URLSearchParams(str));
}

// ✅ 正确的 UTF-8 解码
function decodeBase64Utf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

// 获取 GitHub 文件内容
async function fetchGithubFile(path) {
  const cacheKey = `file:${path}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;
  return await __orig_fetchGithubFile(path);
}
async function __orig_fetchGithubFile(path) {
  const url = `https://api.github.com/repos/${github_owner}/${github_repo}/contents/${path}?ref=main`; // 如果仓库是 master 改这里
  const init = {
    method: "GET",
    headers: {
      Authorization: `token ${github_token}`,
      "User-Agent": "Cloudflare-Worker"
    }
  };
  const response = await fetch(url, init);
  if (response.status === 200) {
    const json = await response.json();
    const content = json.content.replace(/\n/g, "");
    return decodeBase64Utf8(content); // ✅ UTF-8 解码
  } else {
    return null;
  }
}

// 获取 posts/ 下所有文章
async function fetchPostsList() {
  const cacheKey = "posts:list";
  const cached = await cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const posts = await __orig_fetchPostsList();
  await cache.put(cacheKey, JSON.stringify(posts), { expirationTtl: 600 });
  return posts;
}
async function __orig_fetchPostsList() {
  const url = `https://api.github.com/repos/${github_owner}/${github_repo}/contents/posts`;
  const init = {
    method: "GET",
    headers: {
      Authorization: `token ${github_token}`,
      "User-Agent": "Cloudflare-Worker"
    }
  };
  const response = await fetch(url, init);
  if (response.status !== 200) return [];
  const files = await response.json();

  let posts = [];

  async function parseFile(file) {
    if (file.type === "file" && file.name.endsWith(".md")) {
      // 获取最后修改时间
      const commitsUrl = `https://api.github.com/repos/${github_owner}/${github_repo}/commits?path=${file.path}&page=1&per_page=1`;
      const commitRes = await fetch(commitsUrl, init);
      let commitTime = "";
      if (commitRes.status === 200) {
        const commits = await commitRes.json();
        if (commits.length > 0) {
          commitTime = commits[0].commit.author.date.split("T")[0];
        }
      }

      // front-matter 标签
      let tags = [];
      const raw = await fetchGithubFile(file.path);
      if (raw && raw.startsWith("---")) {
        const lines = raw.split("\n");
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === "---") break;
          if (lines[i].startsWith("tags:")) {
            try {
              tags = JSON.parse(lines[i].replace("tags:", "").trim());
            } catch {
              const m = lines[i].match(/\[(.*)\]/);
              if (m) tags = m[1].split(",").map(t => t.trim());
            }
          }
        }
      }

      posts.push({
        file: file.path,
        title: file.name.replace(/\.md$/, "").replace(/-/g, " "),
        time: commitTime,
        tags: tags
      });
    }
  }

  for (const file of files) {
    if (file.type === "file") {
      await parseFile(file);
    }
    if (file.type === "dir") {
      const subUrl = `https://api.github.com/repos/${github_owner}/${github_repo}/contents/${file.path}`;
      const subRes = await fetch(subUrl, init);
      if (subRes.status === 200) {
        const subFiles = await subRes.json();
        for (const sf of subFiles) await parseFile(sf);
      }
    }
  }

  posts.sort((a, b) => (a.time < b.time ? 1 : -1));
  return posts;
}

// ======= 页面渲染：博客首页/详情 =======
async function bloghandle(request) {
  const $_GET = getRequestParams(request.url);
  const posts = await fetchPostsList();

  let data = `
  <html>
    <head>
      <title>${site_name}</title>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; background:#f8f9fa; }
        header { background:#343a40; color:white; padding:1rem; }
        header h2 { margin:0; }
        header a { color:white; text-decoration:none; margin-right:1rem; }
        nav { margin-top:0.5rem; }
        nav a:hover { text-decoration:underline; }
        .container { display:flex; padding:1rem; }
        .left { flex:3; padding-right:1rem; }
        .right { flex:1; background:#fff; border-left:1px solid #ddd; padding:1rem;
                 border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.05);
                 max-height:100vh; overflow-y:auto; position:sticky; top:0; }
        .post-a { text-decoration:none; color:black; }
        .post-box { background:#fff; margin-bottom:1rem; padding:1rem;
                    border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.1); }
        .search-box input { width:100%; padding:0.5rem; border:1px solid #ccc; border-radius:4px; }
        footer { text-align:center; padding:1rem; margin-top:2rem; background:#f1f1f1; }
        .toc { margin-top:1rem; font-size:0.9rem; }
        .toc ul { list-style:none; padding-left:0; }
        .toc li { margin:4px 0; }
        .toc a { text-decoration:none; color:#007bff; }
        .toc a.active { font-weight:bold; color:#d63384; }
        .toc a:hover { text-decoration:underline; }
        #back-to-top { position:fixed; bottom:30px; right:30px;
                       background:#343a40; color:white; border:none;
                       padding:10px 15px; border-radius:50%; font-size:18px;
                       cursor:pointer; display:none; box-shadow:0 2px 6px rgba(0,0,0,0.2); }
        #back-to-top:hover { background:#495057; }
        .post-meta { margin:0.5em 0; color:#666; }
        .post-meta a { color:#007bff; text-decoration:none; margin-right:6px; }
        .post-meta a:hover { text-decoration:underline; }
      </style>
    </head>
    <body>
      <header>
        <h2><a href="/">${site_name}</a></h2>
        <nav>
          <a href="/">🏠 首页</a>
          <a href="/archive">📚 归档</a>
          <a href="/tags">🏷️ 标签</a>
          <a href="/about">👤 关于我</a>
        </nav>
        <p>${site_desc}</p>
      </header>

      <div class="container">
        <div class="left">`;

  // 首页文章列表
  if ($_GET["p"] == undefined) {
    if (posts.length === 0) {
      data += `<p><blockquote>暂时没有文章！</blockquote></p>`;
    } else {
      const postsJson = JSON.stringify(posts);
      const tagParam = $_GET["tag"] ? `"${$_GET["tag"]}"` : "null";
      data += `<h3>所有文章</h3>
               <div id="post-list"></div>
               <p id="loading-msg" style="text-align:center;color:#666;">下拉加载更多...</p>
               <script>
                 const allPosts = ${postsJson};
                 let page = 0, pageSize = 10;
                 let filteredPosts = allPosts;

                 function renderPosts(reset=false) {
                   if (reset) {
                     page=0; document.getElementById("post-list").innerHTML="";
                     document.getElementById("loading-msg").innerText="下拉加载更多...";
                     window.addEventListener("scroll", handleScroll);
                   }
                   const slice = filteredPosts.slice(page*pageSize, (page+1)*pageSize);
                   slice.forEach(post => {
                     const el=document.createElement("a");
                     el.href="?p="+encodeURIComponent(post.file);
                     el.className="post-a";
                     el.innerHTML=\`<div class="post-box"><h4>\${post.title}</h4>
                                    <p>最后修改于 \${post.time}</p></div>\`;
                     document.getElementById("post-list").appendChild(el);
                   });
                   page++;
                   if (page*pageSize>=filteredPosts.length) {
                     document.getElementById("loading-msg").innerText="没有更多文章了";
                     window.removeEventListener("scroll", handleScroll);
                   }
                 }
                 function handleScroll(){ if(window.innerHeight+window.scrollY>=document.body.offsetHeight-200){renderPosts();}}
                 function searchPosts(keyword){
                   keyword=keyword.toLowerCase();
                   filteredPosts=allPosts.filter(p=>p.title.toLowerCase().includes(keyword)||p.time.includes(keyword)||(p.tags&&p.tags.join(" ").toLowerCase().includes(keyword)));
                   renderPosts(true);
                 }
                 function filterByTag(tag){
                   filteredPosts=allPosts.filter(p=>p.tags&&p.tags.includes(tag));
                   renderPosts(true);
                   history.replaceState(null,"","?tag="+encodeURIComponent(tag));
                 }
                 document.addEventListener("DOMContentLoaded",()=>{
                   const tags={}; allPosts.forEach(p=>(p.tags||[]).forEach(t=>tags[t]=(tags[t]||0)+1));
                   let html=""; Object.keys(tags).sort().forEach(t=>{html+='<span style="margin:3px;cursor:pointer;color:#007bff;" onclick="filterByTag(\\''+t+'\\')">#'+t+'</span>';});
                   document.getElementById("tag-cloud").innerHTML=html||"<em>暂无标签</em>";
                   const initTag=${tagParam}; if(initTag)filterByTag(initTag); else renderPosts();
                   window.addEventListener("scroll",handleScroll);
                 });
               </script>`;
    }
  }
  // 文章详情页
  else {
    const resptxt = await fetchGithubFile($_GET["p"]);
    const postMeta = posts.find(p => p.file === $_GET["p"]);
    if (resptxt) {
      data += `<div class="post-box post-content">
                 <h2>${postMeta ? postMeta.title : "未命名文章"}</h2>
                 <div class="post-meta">
                   🕒 最后修改: ${postMeta ? postMeta.time : "未知"}
                   ${postMeta && postMeta.tags && postMeta.tags.length>0 ? " | 标签: "+postMeta.tags.map(t=>`<a href='?tag=${encodeURIComponent(t)}'>#${t}</a>`).join(" ") : ""}
                 </div><hr>
                 <div id="markdown-content" style="display:none;">${resptxt.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
                 <div id="markdown-render"></div>
               </div>
               <script>
                 marked.setOptions({ highlight:(code,lang)=>{try{return hljs.highlight(code,{language:lang}).value;}catch(e){return hljs.highlightAuto(code).value;}} });
                 document.addEventListener("DOMContentLoaded",()=>{
                   document.getElementById("markdown-render").innerHTML=marked.parse(document.getElementById("markdown-content").innerText);
                   const tocList=[]; document.querySelectorAll('.post-content h1, .post-content h2, .post-content h3').forEach((el,i)=>{const id='heading-'+i; el.id=id; tocList.push({level:el.tagName,text:el.innerText,id});});
                   let tocHtml='<ul>'; tocList.forEach(it=>{const ind=(it.level==='H2')?'&nbsp;&nbsp;':(it.level==='H3'?'&nbsp;&nbsp;&nbsp;&nbsp;':''); tocHtml+='<li><a href="#'+it.id+'">'+ind+it.text+'</a></li>';}); tocHtml+='</ul>';
                   document.getElementById("toc").innerHTML=tocHtml;
                   const tocLinks=document.querySelectorAll('#toc a'); const obs=new IntersectionObserver(es=>{es.forEach(en=>{if(en.isIntersecting){tocLinks.forEach(a=>a.classList.remove('active')); const act=document.querySelector('#toc a[href="#'+en.target.id+'"]'); if(act)act.classList.add('active');}});},{rootMargin:"-30% 0px -60% 0px"}); document.querySelectorAll('.post-content h1, .post-content h2, .post-content h3').forEach(h=>obs.observe(h));
                 });
               </script>`;
    } else {
      data += `<h3>404 Not Found</h3><p>您所访问的文章不存在。</p>`;
    }
  }

    // 添加评论系统
    data += `
    <div class="comments" style="padding: 1rem;">
        <iframe src="https://commentsystem.d-7e7.workers.dev/area/8911" style="width: 100%; height: 500px; border: none;"></iframe>
    </div>
    `;
	
	  // 右侧栏
	const aboutRaw = await fetchGithubFile("about.md");
	const aboutHtml = aboutRaw
	  ? aboutRaw.replace(/</g, "&lt;").replace(/>/g, "&gt;")
	  : "还没有写 about.md";

	data += `</div>
			<div class="right">
			  <h3>关于我</h3>
			  <div id="about-md" style="display:none;">${aboutHtml}</div>
			  <div id="about-html"><em>加载中...</em></div>
			  <hr>
			  <h3>搜索</h3><div class="search-box"><input type="text" placeholder="搜索文章..." onkeyup="searchPosts(this.value)"></div><hr>
			  <h3>目录</h3><div id="toc" class="toc"><em>（正文加载后生成）</em></div><hr>
			  <h3>标签</h3><div id="tag-cloud"></div>
			</div>
		  </div>
		  <footer>${copyright}</footer>
		  <button id="back-to-top" title="返回顶部">↑</button>
		  <script>
			// 渲染 about.md
			marked.setOptions({ highlight:(code,lang)=>{try{return hljs.highlight(code,{language:lang}).value;}catch(e){return hljs.highlightAuto(code).value;}} });
			document.addEventListener("DOMContentLoaded",()=>{
			  const aboutRaw=document.getElementById("about-md").innerText;
			  document.getElementById("about-html").innerHTML = marked.parse(aboutRaw);
			});

			// 返回顶部按钮
			const backToTop=document.getElementById("back-to-top");
			window.addEventListener("scroll",()=>{backToTop.style.display=(window.scrollY>300)?"block":"none";});
			backToTop.addEventListener("click",()=>window.scrollTo({top:0,behavior:"smooth"}));
		  </script>
		</body>
	  </html>`;
  return data;
}

// ======= Worker 主入口 =======
async function handleRequest(request) {
  const url = new URL(request.url);
    

  // 归档页
  
  
  if (url.pathname === "/admin") {
    if (request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password");
      if (password !== adminKey) {
        return new Response("<h1>密码错误</h1>", { headers: { "Content-Type": "text/html; charset=UTF-8" } });
      }
      // 返回管理页（和博客主题一致的布局）
      return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>管理页面</title>
        <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/highlight.js/lib/common.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/highlight.js/styles/github-dark.min.css"></script>
        </head><body>
        <header><h2><a href="/">${site_name}</a></h2><nav>
          <a href="/">🏠 首页</a> <a href="/archive">📚 归档</a> <a href="/tags">🏷️ 标签</a> <a href="/about">👤 关于我</a> <a href="/admin">⚙ 管理</a>
        </nav><p>${site_desc}</p></header>
        <main>
          <h1>缓存管理</h1>
          <button onclick="checkStatus()">查看缓存</button>
          <button onclick="clearCache()">清除缓存</button>
          <pre id="output"></pre>
        </main>
        <footer>${copyright}</footer>
        <script>
          async function checkStatus(){
            const res = await fetch('/admin?action=status', {headers:{Authorization:"Bearer ${adminKey}"}});
            const data = await res.json();
            document.getElementById('output').innerText = '缓存数量: '+data.count+'\\n'+data.keys.join('\\n');
          }
          async function clearCache(){
            const res = await fetch('/admin?action=clear', {method:'POST', headers:{Authorization:"Bearer ${adminKey}"}});
            const data = await res.json();
            document.getElementById('output').innerText = data.msg;
          }
        </script>
        </body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    // 如果是 GET 请求，返回登录页面
    return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>登录管理</title></head><body>
      <header><h2><a href="/">${site_name}</a></h2><nav>
        <a href="/">🏠 首页</a> <a href="/archive">📚 归档</a> <a href="/tags">🏷️ 标签</a> <a href="/about">👤 关于我</a> <a href="/admin">⚙ 管理</a>
      </nav><p>${site_desc}</p></header>
      <main>
        <h1>管理员登录</h1>
        <form method="POST">
          <input type="password" name="password" placeholder="请输入管理密码" required />
          <button type="submit">登录</button>
        </form>
      </main>
      <footer>${copyright}</footer>
    </body></html>`, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
  }

  // 处理 /admin?action=status 或 /admin?action=clear 的接口请求
  if (url.pathname === "/admin" && url.searchParams.get("action")) {
    const auth = request.headers.get("Authorization");
    if (auth !== "Bearer " + adminKey) return new Response("403 Forbidden", { status: 403 });
    const action = url.searchParams.get("action");
    if (action === "clear") {
      let cursor = null;
      do {
        const list = await cache.list({ cursor });
        for (const k of list.keys) await cache.delete(k.name);
        cursor = list.cursor;
      } while (cursor);
      return new Response(JSON.stringify({msg:"✅ 缓存已清空"}), { headers: { "Content-Type": "application/json" } });
    }
    if (action === "status") {
      let cursor = null, keys = [];
      do {
        const list = await cache.list({ cursor });
        keys.push(...list.keys.map(k => k.name));
        cursor = list.cursor;
      } while (cursor);
      return new Response(JSON.stringify({count: keys.length, keys}), { headers: { "Content-Type": "application/json" } });
    }
  }

  if (url.pathname === "/archive") {
    const posts = await fetchPostsList();
    let grouped = {};
    posts.forEach(p => { const ym=p.time?p.time.substring(0,7):"未知日期"; if(!grouped[ym])grouped[ym]=[]; grouped[ym].push(p); });
    const sorted=Object.keys(grouped).sort((a,b)=>(a<b?1:-1));
    let data = `<html><head><title>归档 - ${site_name}</title><meta charset="UTF-8"></head><body>`;
    data += `<header><h2><a href="/">${site_name}</a></h2><nav><a href="/">🏠 首页</a><a href="/archive">📚 归档</a><a href="/tags">🏷️ 标签</a><a href="/about">👤 关于我</a></nav><p>${site_desc}</p></header>`;
    data += `<div class="container"><h1>📚 文章归档</h1>`;
    sorted.forEach(ym=>{data+=`<h2>📅 ${ym}</h2><ul>`; grouped[ym].forEach(p=>{data+=`<li><a href="/?p=${encodeURIComponent(p.file)}">${p.title}</a></li>`}); data+="</ul>";});
    data+=`</div><footer>${copyright}</footer></body></html>`;
    return new Response(data,{headers:{"Content-Type":"text/html; charset=UTF-8"}});
  }

  // 标签页
  if (url.pathname === "/tags") {
    const posts=await fetchPostsList(); let tags={}; posts.forEach(p=>(p.tags||[]).forEach(t=>tags[t]=(tags[t]||0)+1));
    let data=`<html><head><title>标签 - ${site_name}</title><meta charset="UTF-8"></head><body>`;
    data+=`<header><h2><a href="/">${site_name}</a></h2><nav><a href="/">🏠 首页</a><a href="/archive">📚 归档</a><a href="/tags">🏷️ 标签</a><a href="/about">👤 关于我</a></nav><p>${site_desc}</p></header>`;
    data+=`<div class="container"><h1>🏷️ 标签</h1>`;
    if(Object.keys(tags).length===0){data+=`<p><em>暂无标签</em></p>`;}else{Object.keys(tags).sort().forEach(tag=>{data+=`<span><a href="/?tag=${encodeURIComponent(tag)}">#${tag} (${tags[tag]})</a></span> `;});}
    data+=`</div><footer>${copyright}</footer></body></html>`;
    return new Response(data,{headers:{"Content-Type":"text/html; charset=UTF-8"}});
  }

  // 关于我（from about.md）
  if (url.pathname === "/about") {
    const raw = await fetchGithubFile("about.md");
    let htmlContent = raw ? raw.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "还没有写 about.md";

    let data = `<html><head><title>关于我 - ${site_name}</title><meta charset="UTF-8">
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css">
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js"></script>
    </head><body>
      <header><h2><a href="/">${site_name}</a></h2>
      <nav><a href="/">🏠 首页</a><a href="/archive">📚 归档</a><a href="/tags">🏷️ 标签</a><a href="/about">👤 关于我</a></nav>
      <p>${site_desc}</p></header>
      <div class="container">
        <h1>👤 关于我</h1>
        <div id="about-md" style="display:none;">${htmlContent}</div>
        <div id="about-html"></div>
      </div>
      <footer>${copyright}</footer>
      <script>
        marked.setOptions({ highlight:(code,lang)=>{try{return hljs.highlight(code,{language:lang}).value;}catch(e){return hljs.highlightAuto(code).value;}} });
        document.addEventListener("DOMContentLoaded",()=>{document.getElementById("about-html").innerHTML=marked.parse(document.getElementById("about-md").innerText);});
      </script>
    </body></html>`;
    return new Response(data,{headers:{"Content-Type":"text/html; charset=UTF-8"}});
  }

  // 默认：首页/文章详情
  const html = await bloghandle(request);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}