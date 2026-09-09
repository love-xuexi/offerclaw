(function (root) {
  const api = root.OfferClaw = root.OfferClaw || {};
  const cssRulePattern = /[.#]?[A-Za-z0-9_\-\s,>:()\[\]="']*\{[^{}]*\}/g;
  const stripCssNoise = (value) => {
    let clean = String(value || "");
    for (let i = 0; i < 2; i++) clean = clean.replace(cssRulePattern, " ");
    return clean.replace(/\s+/g, " ").trim();
  };
  const rawText = (el) => {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll("style, script, noscript, template").forEach((node) => node.remove());
    return clone.textContent || "";
  };
  const cleanText = (el) => stripCssNoise(rawText(el));
  const salarySelectors = [".job-salary", ".salary", ".sal", ".job-limit .red", ".job-limit b", "[class*='salary']", "[class*='Salary']", "[class*='wage']", "[class*='pay']", ".red"];
  const salaryUnit = "(?:万|千|[KkＫ]|元\\s*\\/?\\s*[天日周月年]?)";
  const salaryPatterns = [
    // 人民币：20-30K / 1.2-2万 / 3000-5000元/月 / 面议
    new RegExp("\\d+(?:\\.\\d+)?\\s*[KkＫ千万]?\\s*[-~～至到]\\s*\\d+(?:\\.\\d+)?\\s*" + salaryUnit),
    new RegExp("\\d+(?:\\.\\d+)?\\s*" + salaryUnit),
    // 美元：$120,000/yr、$150k、$50 - $70 per hour（LinkedIn 等英文站常见）
    /(?:\$|USD\s?)\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[Kk]?(?:\s*[-~～至到]\s*(?:\$)?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[Kk]?)?(?:\s*\/\s*(?:yr|year|hr|hour|month|mo|week|wk)|\s*per\s*(?:year|hour|month|week))?/i,
    /(?:薪资|待遇|薪酬)?面议/
  ];
  const salaryFromText = (value) => {
    const text = String(value || "").replace(/\s+/g, " ");
    let best = "";
    for (const pattern of salaryPatterns) { const match = text.match(pattern); if (match) { best = match[0]; break; } }
    if (!best) return "";
    // 中文薪资单位去掉空格更紧凑；英文（$120,000/yr）保住空格，免得变成 $50-$70perhour
    if (/[万亿千百元薪KkＫ天日周月年]/.test(best)) best = best.replace(/\s+/g, "");
    const bonus = text.match(/\d{1,2}\s*薪/)?.[0].replace(/\s+/g, "");
    return bonus ? `${best}·${bonus}` : best;
  };
  const salaryLeaf = (root) => {
    if (!root) return "";
    const byClass = salaryFromText(cleanText(first(salarySelectors, root)));
    if (byClass) return byClass;
    let nodes;
    try { nodes = root.querySelectorAll("*"); } catch (_) { nodes = []; }
    // 这里只要短文本跑一次薪资正则，用 cleanText 会对每个节点做一次 cloneNode，列表页上足以卡住几秒
    for (const node of nodes) {
      if (node.tagName === "STYLE" || node.tagName === "SCRIPT" || node.tagName === "NOSCRIPT" || node.tagName === "TEMPLATE") continue;
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 40) { const hit = salaryFromText(text); if (hit) return hit; }
    }
    return "";
  };
  const cssBraceRatio = (value) => ((String(value).match(/[{}]/g) || []).length / Math.max(String(value).length, 1));
  const first = (selectors, scope = document) => {
    for (const selector of selectors) for (const el of scope.querySelectorAll(selector)) if (cleanText(el)) return el;
    return null;
  };
  // 公司/城市的选择器很泛（`.company-name`、`[class*='city']`），在整个 document 上搜第一个命中，
  // 很容易抓到站点页头的品牌名或侧栏的整段办公地址。加一层校验后跳过不合格的元素继续往下找。
  const firstValid = (selectors, valid, scope = document) => {
    for (const selector of selectors) for (const el of scope.querySelectorAll(selector)) {
      const text = cleanText(el);
      if (text && valid(text)) return el;
    }
    return null;
  };
  const SITE_BRANDS = /^(BOSS\s*直聘|Boss|实习僧|前程无忧|51job|LinkedIn|领英)$/i;
  const isCompanyName = (text) => text.length <= 40 && !SITE_BRANDS.test(text);
  // 城市名很短；"北京朝阳区光华路SOHO2C座11楼8号 点击查看地图" 这种整段地址不是我们要的
  const isCityName = (text) => text.length <= 16;
  const largest = () => [...document.querySelectorAll("main, article, section, .content, .description, [class*='detail'], [class*='description']")]
    .map((el) => ({ el, raw: rawText(el), clean: cleanText(el) }))
    .filter(({ el, raw, clean }) => el.offsetParent !== null && clean.length >= 40 && cssBraceRatio(raw) <= 0.6)
    .sort((a, b) => b.clean.length - a.clean.length)[0]?.el;
  // Greenhouse / Lever / Workday 等 ATS 页面基本都带 schema.org 的 JobPosting 结构化数据，
  // 比猜 DOM 选择器可靠得多；JSON-LD 是页面主动提供给爬虫的公开元数据，取它不算绕过反爬。
  const jsonLdJobPosting = () => {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(script.textContent); } catch (_) { continue; }
      const nodes = Array.isArray(data) ? data : [data];
      for (const node of nodes) {
        if (!node || String(node["@type"] || "").toLowerCase() !== "jobposting") continue;
        const org = node.hiringOrganization || {};
        const loc = (node.jobLocation && (Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation)) || {};
        const value = (node.baseSalary?.value) || {};
        return {
          title: String(node.title || ""),
          company: String(org.name || ""),
          location: String(loc.address?.addressLocality || loc.address?.addressRegion || ""),
          // 结构化薪资是 {min,max,unit} 对象；原始数字范围（如 "$120,000 - $150,000"）直接落 text
          salary: typeof node.baseSalary === "string" ? node.baseSalary : [value.min, value.max].filter((v) => v != null).join(" - "),
          description: stripCssNoise(String(node.description || ""))
        };
      }
    }
    return null;
  };
  // ATS 与公司官网的岗位页选择器（在 generic 分支里用，detail/apply/description 是这几家最稳的类名公约）
  const GENERIC_SELECTORS = {
    title: ["h1[class*='job']", ".job-title", "[class*='job-title']", "[class*='position-title']", "h1"],
    company: ["[class*='company-name']", "[class*='company']", "[class*='organization']", ".posting-organization"],
    description: ["[class*='job-description']", "[class*='description']", ".content", "[itemprop='description']", ".posting" ]
  };
  // ── 站点配置表 ────────────────────────────────────────────────────────────────────────────
  // 加一个站 = 在这里加一个条目 + manifest 的 matches + options 页的 checkbox + prompts.js 的 FULL_JD_SITES。
  // 每个条目：domain 正则；详情页选择器（title/company/description）；
  //   cards 列表卡片选择器；deepScan 取完整 JD 的策略——
  //   "fetch"（抓同源详情页，配 detailDoc 把 fetch 来的文档解析回 Job 字段）、
  //   "click"（点卡片读同页详情面板，配 openJd()）、""（卡片摘要就是全部，不做深度抓取）。
  const SITES = {
    zhipin: {
      domain: /zhipin\.com/,
      title: [".job-primary .name", ".job-banner h1"],
      company: [".job-primary .company-name"],
      description: [".job-sec-text", ".job-detail-section .job-sec-text", ".job-detail .text", "[class*='job-detail'] [class*='text']", ".desc", ".job-detail .job-sec-text", ".job-detail-section"],
      cards: [".job-card-box", "li.job-card-wrapper", ".job-card-wrapper", "ul.rec-job-list > li", ".rec-job-list li", "li.job-card"],
      cardExtra: "li", // BOSS 的 li 启发式：li 内含岗位名容器的也算卡片
      deepScan: "click",
      // BOSS 详情页公司名必须从 document.title 取：.company-name 命中的是侧栏轮播"推荐公司"，见 AGENTS.md
      companyFrom: () => (document.title.match(/」_(.+?)招聘-BOSS直聘/) || [])[1] || ""
    },
    shixiseng: {
      domain: /shixiseng\.com/,
      title: [".new_job_name"],
      company: [".com-name"],
      description: [".job_detail", ".job_til"],
      cards: [".intern-wrap", ".intern-item"],
      cardLink: "a[href*='/intern/inn_']",
      deepScan: "fetch"
    },
    job51: {
      domain: /51job\.com/,
      // 不能用裸 h1 兜底：搜索列表页的 h1 是"APP下载"之类的站点栏目名，
      // 命中后 identified 会变成 true，把列表页第一张卡片的公司/JD 拼成一个假岗位
      title: [".cn h1", ".tHeader h1", "[class*='job-title']"],
      company: [".cname", ".com_msg .cname", "[class*='company-name']"],
      description: [".job_msg", ".bmsg", "[class*='job-detail'] [class*='msg']", "[class*='describe']"],
      cards: [".joblist-item"],
      // 51job 卡片内没有岗位 <a>，岗位 id 在埋点属性里，用官方岗位链接格式拼地址；详情页受 WAF 保护不做深度抓取
      cardUrl: (el) => {
        try {
          const raw = el.querySelector("[sensorsdata]")?.getAttribute("sensorsdata");
          const id = raw && JSON.parse(raw).jobId;
          return id ? `https://jobs.51job.com/all/${id}.html` : "";
        } catch (_) { return ""; }
      },
      deepScan: ""
    },
    // 智联 / 牛客 / 应届生：先按“当前页详情 + 列表卡片摘要”保守适配，不做详情页批量抓取。
    // 智联 / 牛客选择器来自真实页面实测；应届生详情页有滑动验证，列表以岗位链接为卡片，均不做深度抓取。
    zhaopin: {
      domain: /zhaopin\.com/,
      title: ["h1", "[class*='job-name']", "[class*='position-name']"],
      company: [".company-info__name", "[class*='company-name']", "[class*='company']"],
      description: [".job-info__desc", "[class*='job-description']", "[class*='description']"],
      // 卡片本身没有 <a>；岗位 id 在 sensors 埋点里，官方详情格式为 /job/<jdno>
      cards: [".position-card", "[class*='job-card']", "[class*='job-item']"],
      cardCompany: ".position-card__company__name",
      cardUrl: (el) => {
        try {
          const raw = el.getAttribute("data-sensors-exposure-option");
          const id = raw && JSON.parse(raw).properties?.jdno;
          return id ? new URL(`/job/${id}`, location.origin).href : "";
        } catch (_) { return ""; }
      },
      deepScan: "fetch"
    },
    nowcoder: {
      domain: /nowcoder\.com/,
      // 详情页 h1 才是当前岗位；class 匹配会先命中“看过该职位”推荐位的 job-name
      title: ["h1", "[class*='job-name']", "[class*='position-name']"],
      company: ["[class*='company-name']", "[class*='company']"],
      // job-detail-wrap 只是头部包装，完整 JD 在 job-detail-word / job-detail-infos
      description: [".job-detail-word", ".job-detail-infos", "[class*='job-description']", "[class*='job-detail']", "[class*='description']"],
      cards: ["[class*='job-card']", "[class*='job-item']", "[class*='position-card']"],
      cardExtra: "li",
      deepScan: "fetch"
    },
    yingjiesheng: {
      domain: /yingjiesheng\.com/,
      title: [".detail-title-left-top .job", "h1", "[class*='job-name']", "[class*='position-name']"],
      company: [".detail-content-compnav-center", "[class*='company-name']", "[class*='company']"],
      description: [".jobinfo", "[class*='job-description']", "[class*='job-detail']", "[class*='description']"],
      // 搜索页的岗位单元就是 jobdetail 链接本身；链接第一个子元素是岗位名容器
      cards: ["a[href*='/jobdetail/']"],
      cardLink: ":scope > *",
      cardUrl: (el) => el.href,
      // 详情页会遇到阿里云滑动验证：不绕过；批量扫描只用当前页卡片摘要
      deepScan: ""
    },
    linkedin: {
      domain: /linkedin\.com/,
      title: [".job-details-jobs-unified-top-card__job-title", ".top-card-layout__title", ".topcard__title"],
      company: [".job-details-jobs-unified-top-card__company-name", ".topcard__org-name-link"],
      description: [".jobs-description__content", ".show-more-less-html__markup", ".description__text"],
      cards: [".jobs-search-results__list-item", ".job-card-container"],
      deepScan: ""
    },
    // Greenhouse / Lever 是海外校招与中小企业最常用的两家 ATS：板式统一、服务端渲染、
    // 职位列表和详情页基本都带 JobPosting JSON-LD，结构化数据兜底即可，不需要专门的选择器。
    greenhouse: {
      domain: /greenhouse\.io/,
      title: [".app-title", "h1"],
      company: [".company-name", ".company-logo + *"],
      description: [".content", "[class*='job-description']", ".posting" ],
      cards: [".job-post", ".job-posting", "article", "li"],
      deepScan: ""
    },
    lever: {
      domain: /lever\.co/,
      title: [".posting-title", "[class*='posting-title']", "h1"],
      company: [".posting-company", ".sort-info", "[class*='company']"],
      description: [".content", ".posting-page", "[class*='description']"],
      cards: [".posting", "li"],
      deepScan: ""
    },
    generic: {
      domain: /.*/,
      ...GENERIC_SELECTORS,
      cards: ["article", "li"],
      deepScan: ""
    }
  };
  api.detectSite = (url = location.href) => {
    for (const [key, site] of Object.entries(SITES)) if (key !== "generic" && site.domain.test(url)) return key;
    return "generic";
  };
  const siteConfig = () => SITES[api.detectSite()] || SITES.generic;
  api.extractJob = () => {
    const site = api.detectSite();
    const config = siteConfig();
    // generic 页面（企业官网 / Greenhouse / Lever 等 ATS）优先信 JSON-LD 的 JobPosting 结构化数据
    const structured = site === "generic" ? jsonLdJobPosting() : null;
    const titleEl = structured?.title ? null : first(config.title);
    const companyEl = structured?.company ? null : firstValid(config.company, isCompanyName);
    const companyName = (config.companyFrom?.() || "") || cleanText(companyEl) || structured?.company || "";
    const descEl = first(config.description) || largest();
    const selected = String(getSelection?.().toString() || "").trim();
    // 不拿 document.title 兜底：列表页上没有单个岗位，用页面标题会让面板显示成"BOSS直聘"这种假岗位。
    // 连标题都没识别出来（列表页、首页、登录页）时，其余字段一律留空——否则会把城市选择器的"请选择城市"、
    // 站点的 meta description 当成这个"岗位"的公司和 JD 显示出来，看着像抓到了，其实全是噪音。
    const titleText = structured?.title || cleanText(titleEl);
    const identified = Boolean(titleText);
    const salary = structured?.salary || salaryFromText(cleanText(first(salarySelectors))) || salaryFromText(cleanText(document.body));
    // 选中文本只当通用兜底：已适配的站点上任何一次划词（哪怕双击一个词）都不该顶掉站点选择器抓到的 JD
    const siteDescription = cleanText(descEl) || document.querySelector("meta[name='description']")?.content || "";
    return {
      id: "job-" + Date.now(), site, url: location.href, title: titleText || "未识别到岗位",
      company: identified ? companyName : "",
      location: identified ? (structured?.location || cleanText(firstValid([".location", ".job-location", ".area", "[class*='address']", "[class*='city']"], isCityName)) || "") : "",
      salary: identified ? salary : "",
      description: identified ? stripCssNoise(site === "generic" && selected.length >= 40 ? selected : (siteDescription || selected)) : "",
      extractedAt: new Date().toISOString(), score: null, verdict: null, matched: [], missing: [], reasons: "", status: "scored", greeting: "", updatedAt: new Date().toISOString()
    };
  };
  // 深度扫描策略表：panel.js 的 scan() 据此分流，不再自己 switch site
  api.deepScanStrategy = (site) => SITES[site]?.deepScan || "";
  // fetch 深度扫描的详情页解析：按站点 SITES 配置读取标题 / 公司 / JD，避免每个站点复制一份解析函数
  const siteDetail = (site, doc) => {
    const config = SITES[site] || SITES.generic;
    return {
      title: cleanText(first(config.title, doc)) || "",
      company: cleanText(first(config.company, doc)) || "",
      description: stripCssNoise(cleanText(first(config.description, doc)) || ""),
      salary: salaryFromText(cleanText(first(salarySelectors, doc))) || salaryFromText(cleanText(doc.body)) || "",
      location: cleanText(first([".location", ".job-location", ".area", "[class*='address']", "[class*='city']"], doc)) || ""
    };
  };
  // 深度扫描（"fetch" 策略）：抓详情页补全 JD；失败/空壳/反爬时回退原卡片文字
  api.fetchJobDetail = async (job) => {
    if (api.deepScanStrategy(job.site) !== "fetch" || !job.url) return job;
    // 卡片里岗位链接的兜底选择器是 a[href]，可能命中广告或外站链接；带 cookie 的请求只允许发给同源详情页
    let target;
    try { target = new URL(job.url, location.href); } catch (_) { return job; }
    if (target.origin !== location.origin) return job;
    try {
      const res = await fetch(target.href, { credentials: "include" });
      if (!res.ok) return job;
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const d = siteDetail(job.site, doc);
      if (!d.description) return job;
      return { ...job, title: d.title || job.title, company: d.company || job.company, description: d.description, ...(d.salary ? { salary: d.salary } : {}), ...(d.location ? { location: d.location } : {}) };
    } catch (_) { return job; }
  };
  // BOSS 列表页点开卡片后，右侧详情面板在同页更新出完整 JD。类名会随改版变化，所以再用“职位描述”标题锚定一条兜底路径
  const textNearHeading = (heading) => {
    for (const el of document.querySelectorAll("h1,h2,h3,h4,div,span,p")) {
      if (cleanText(el) !== heading) continue;
      let node = el.nextElementSibling;
      while (node) {
        const text = cleanText(node);
        if (text.length >= 60) return text;
        node = node.nextElementSibling;
      }
      const host = el.parentElement;
      if (host) {
        const text = cleanText(host).replace(heading, "").trim();
        if (text.length >= 60) return text;
      }
    }
    return "";
  };
  // 深度扫描（"click" 策略）配套：读同页右侧详情面板的完整 JD
  api.readOpenJd = () => {
    if (api.deepScanStrategy(api.detectSite()) !== "click") return "";
    const byClass = cleanText(first([".job-detail-box .job-sec-text", ".job-sec-text", ".job-detail-section .job-sec-text", ".job-detail .text"]));
    return stripCssNoise(byClass.length >= 60 ? byClass : textNearHeading("职位描述"));
  };
  api.extractJobList = () => {
    const site = api.detectSite();
    const config = siteConfig();
    const cards = [...new Set(config.cards.flatMap((selector) => [...document.querySelectorAll(selector)]))];
    const cardSet = new Set(cards);
    // BOSS 的 li 启发式：选择器没覆盖到、但内部含岗位名容器的 li 也是卡片
    if (config.cardExtra) for (const el of document.querySelectorAll(config.cardExtra)) if (!cardSet.has(el) && el.querySelector("[class*='job-name'],[class*='job-title']")) { cards.push(el); cardSet.add(el); }
    const result = [];
    const companySelectors = [".cname", ".company-name", ".boss-name", "[class*='company']", "[class*='boss-name']"];
    for (const el of cards) {
      const link = config.cardLink ? el.querySelector(config.cardLink) : el.querySelector("a[href]");
      const cardText = cleanText(el);
      const cardUrl = config.cardUrl ? config.cardUrl(el) : link ? new URL(link.href, location.href).href : "";
      // 没解析出岗位链接的"卡片"不是岗位：BOSS 的 li 启发式会把技能标签之类的容器也算进来，
      // 之前用 location.href 兜底，结果排名列表里混进「发表算法相关优秀论文」这种条目，
      // 而且这类条目共用同一个 url，saveJob 按 url 去重时会互相覆盖。
      if (!cardUrl || cardText.length < 10) continue;
      const titleEl = first([config.cardLink, ".jname", ".title", ".job-name", ".job-title", "[class*='job-name']", "[class*='job-title']", "h3", "h2"].filter(Boolean), el);
      const companyEl = config.cardCompany
        ? first([config.cardCompany], el) || first(companySelectors, el)
        : first(companySelectors, el);
      // 薪资只在卡片自身里找：原来会往上爬 8 层祖先，BOSS 列表页很多卡片写着"面议"，
      // 一爬就把隔壁卡片的薪资当成本卡片的。BOSS 还把薪资数字放在 CSS 生成内容里（文本节点只剩 "-K·薪"），
      // 取不到就留空，面板会显示"薪资待确认"——比显示一个错的数字诚实。
      result.push({ id: "job-" + Math.random().toString(36).slice(2), site, url: cardUrl, title: cleanText(titleEl) || cardText.slice(0, 100), company: cleanText(companyEl), location: cleanText(firstValid([".location", ".area", "[class*='city']"], isCityName, el)), salary: salaryLeaf(el), description: cardText, extractedAt: new Date().toISOString(), score: null, verdict: null, matched: [], missing: [], reasons: "", status: "scored", greeting: "", updatedAt: new Date().toISOString(), el });
    }
    return result.filter((item, index, all) => all.findIndex((other) => `${other.url}|${other.title}|${other.company}` === `${item.url}|${item.title}|${item.company}`) === index);
  };
})(globalThis);
