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
  // ATS 官网的公司名大多只写在 title / meta keywords 里（"XX公司校园招聘"、"职位 - XX校招"）。
  // 北森部分租户（如合合信息）整页没有公司名，这时宁可留空——BOSS 直聘的教训：错的公司名比空着更糟。
  const companyNameFromMeta = () => {
    const sources = [document.querySelector("meta[name='keywords']")?.content || "", document.title];
    for (const source of sources) {
      for (const part of String(source).split(/[,，|]| - /)) {
        const name = part.replace(/(校园|社会)?招聘$|校招$|热招$/, "").trim();
        if (name.length >= 2 && !/招聘|校招|官网|职位/.test(name) && !/^(校园|社会|秋招|春招|官网|首页|加入)$/.test(name)) return name;
      }
    }
    return "";
  };
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
  //   "fetch"（并发抓同源详情页补全；站点配了 fetchDetail 钩子时改抓同源 JSON API）、
  //   "click"（点卡片读同页详情面板，配 readOpenJd）、
  //   "navigate"（卡片没 JD 且详情是同页 hash 路由：逐岗跳详情读完再返回，配 openJdSelectors）、
  //   ""（卡片摘要就是全部，不做深度抓取）。
  //   可选钩子：cardTitle/cardDescription（列表卡片内的标题/JD 选择器）、
  //   listJobs（扫描前拉一次站点同源列表接口，按卡片标题精确合并 URL 与完整 JD，北森用）。
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
    // 北森 / Moka / 飞书招聘是企业校招官网最常用的三家 ATS。详情页都是纯客户端渲染
    // （fetch 详情 HTML 是空壳，拿不到 JD），完整 JD 分别走列表 API 合并、同页 hash 跳转、同源 JSON API。
    zhiye: {
      domain: /zhiye\.com/,
      // 详情标题在职位 banner 的 STJobName 容器里；不能用 STJobTitle——列表卡片同款类名，
      // 命中后列表页第一张卡会被拼成假岗位（51job 裸 h1 同款坑）
      title: ["[class*='STJobName']", "h1"],
      // 部分租户页面（如合合信息）上没有公司名，靠 title/meta 抠，抠不到留空
      company: [],
      description: ["[class*='STJobDuty']", "[class*='STDutyContainer']", ".pc-job-detail", "[class*='description']"],
      // 新版模板卡片是 STListItem（标题在 STJobTitle 里）；企业定制模板（如中核 /custom/campus）
      // 卡片是 .job-list .item（标题在 .t，完整 JD 折叠在 .con 里——display:none 但 DOM 里有全文）。
      // 左侧"招聘单位"筛选栏的条目也叫 .item，必须用 .job-list 作用域排除
      cards: ["[class*='STListItem']", ".job-list .item"],
      cardTitle: ["[class*='STJobTitle']", ".t"],
      cardDescription: [".con"],
      // 定制模板卡片的公司名在"招聘单位："行里；新版模板卡片没有公司名（返回空，走 companyFrom）
      cardCompany: (el) => ((el.innerText || "").match(/招聘单位：(.+)/) || [])[1]?.trim() || "",
      // 卡片里没有岗位链接也没有 JD。批量扫描用站点自己的列表接口（页面渲染列表用的同一个，
      // 同源 + 用户会话）：一次分页拉全岗位的完整 JD（Duty+Require），按"卡片标题 === JobAdName"
      // 精确合并，无需逐岗深扫。PageSize=1000 实测服务端照单全收（讯飞 893 岗一次拉全），封顶 2 页
      listJobs: async () => {
        const out = [];
        for (let page = 0; page < 2; page++) {
          const res = await fetch(`${location.origin}/api/Jobad/GetJobAdPageList`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ PageIndex: page, PageSize: 1000, DisplayFields: ["Category", "Kind", "LocId", "PostDate", "ClassificationOne"] })
          });
          if (!res.ok) break;
          const json = await res.json().catch(() => null);
          const rows = json?.Data;
          if (!Array.isArray(rows) || !rows.length) break;
          for (const row of rows) {
            const description = [row.Duty, row.Require].map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
            if (!row.JobAdName || !row.Id || !description) continue;
            out.push({
              title: String(row.JobAdName),
              url: new URL(`/campus/detail?jobAdId=${row.Id}`, location.origin).href,
              description: stripCssNoise(description),
              location: Array.isArray(row.LocNames) ? row.LocNames.filter(Boolean).join("、") : "",
              salary: salaryFromText(String(row.Salary || ""))
            });
          }
          if (rows.length < 1000 || (json.Count && out.length >= json.Count)) break;
        }
        return out;
      },
      deepScan: "",
      companyFrom: companyNameFromMeta
    },
    moka: {
      domain: /mokahr\.com/,
      // 两套列表模板：新版（/campus_apply/）卡片 <a> 里自带完整 JD，经典版（/campus-recruitment/）
      // 只有标题和日期；详情页两套模板同构：.apply__content + job-description-* 正文。
      // 标题必须限定在 .apply__content 里：列表页左侧筛选栏的"项目/职位性质"等分组标题
      // 也用 sd-foundation-heading，不限作用域会把筛选页拼成假岗位
      title: [".apply__content [class*='sd-foundation-heading']"],
      company: [],
      description: [".apply__content [class*='job-description-']", "[class*='job-description-']"],
      // 卡片就是 <a href="#/job/<uuid>"> 本身（同卡可能有内外两个 <a>，url/标题相同会被去重）；
      // querySelector 匹配不到自身，卡片自己就是链接时要走 cardUrl 取 href
      cards: ["a[href*='#/job/']"],
      cardUrl: (el) => el.href,
      cardTitle: "[class*='title-']",
      cardDescription: "[class*='job-description-']",
      // API 响应加密走不了；经典模板卡片没 JD，详情是同页 hash 路由且点开后列表卸载，
      // 用 navigate 策略逐岗跳详情读 JD 再返回（新版模板卡片已带全文，扫描时直接跳过）
      deepScan: "navigate",
      openJdSelectors: ["[class*='job-description-']"],
      companyFrom: companyNameFromMeta
    },
    feishu: {
      domain: /jobs\.feishu\.cn/,
      // 详情页正文在稳定类 jobDetail 里，标题是 .job-title；不要把列表卡的 positionItem-title
      // 放进详情选择器，否则列表页会拼出假岗位
      title: [".job-title"],
      company: [],
      description: [".jobDetail", "[class*='job-description']", "[class*='description']"],
      // jobDetail 容器整体取会把职位标题和元信息一起带进来，按 block 精确拼"职位描述+职位要求"
      descriptionFrom: () => [...document.querySelectorAll(".jobDetail [class*='block-content']")]
        .map((block) => (block.innerText || "").trim())
        .filter(Boolean)
        .join("\n\n"),
      // 卡片就是职位 <a>（整卡可点，标题/预览都在里面）；不要用 [class*='positionItem']
      // 做卡片——标题/副标题/预览的类名都含这个词，会把卡片内部元素也当成卡片
      cards: ["a[href*='/position/']"],
      cardUrl: (el) => el.href,
      // title-text 是标题正文专属元素；外层 positionItem-title 会把"推荐投递"徽标一起带进标题
      cardTitle: "[class*='positionItem-title-text']",
      cardDescription: "[class*='positionItem-jobDesc']",
      // 详情页纯客户端渲染（fetch HTML 无 JD）；但岗位 JSON API 无需 _signature，
      // 同源 GET 即可拿到 description + requirement + 城市
      fetchDetail: async (url) => {
        const id = String(url).match(/\/position\/(\d+)/)?.[1];
        if (!id) return null;
        const res = await fetch(`${location.origin}/api/v1/job/posts/${id}?portal_type=6&with_recommend=false`, { credentials: "include" });
        if (!res.ok) return null;
        const json = await res.json().catch(() => null);
        const post = json?.data?.job_post_detail;
        if (!post) return null;
        const description = [post.description, post.requirement].map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
        if (!description) return null;
        return {
          title: String(post.title || ""),
          description: stripCssNoise(description),
          location: (Array.isArray(post.city_list) ? post.city_list : []).map((c) => c?.name).filter(Boolean).join("、")
        };
      },
      deepScan: "fetch",
      companyFrom: companyNameFromMeta
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
    // 站点配了 descriptionFrom 钩子时用它精确拼 JD（飞书：职位描述/职位要求是两个并列 block，
    // 容器整体取会把标题和元信息一起带进来）；没有就用选择器 + largest 兜底
    const siteDescription = config.descriptionFrom?.() || cleanText(descEl) || document.querySelector("meta[name='description']")?.content || "";
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
      // 站点配了 fetchDetail 钩子时抓同源 JSON 而不是解析 HTML：飞书详情页是纯客户端渲染，fetch HTML 是空壳
      if (SITES[job.site]?.fetchDetail) {
        const d = await SITES[job.site].fetchDetail(target.href);
        if (!d?.description) return job;
        return { ...job, title: d.title || job.title, description: d.description, ...(d.location ? { location: d.location } : {}), ...(d.salary ? { salary: d.salary } : {}) };
      }
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
  // 深度扫描（"click"/"navigate" 策略）配套：读同页详情面板 / 当前详情路由的完整 JD
  api.readOpenJd = () => {
    const strategy = api.deepScanStrategy(api.detectSite());
    if (strategy !== "click" && strategy !== "navigate") return "";
    const config = siteConfig();
    const byClass = cleanText(first([...(config.openJdSelectors || []), ".job-detail-box .job-sec-text", ".job-sec-text", ".job-detail-section .job-sec-text", ".job-detail .text"]));
    return stripCssNoise(byClass.length >= 60 ? byClass : textNearHeading("职位描述"));
  };
  api.extractJobList = async () => {
    const site = api.detectSite();
    const config = siteConfig();
    // 北森这类站点卡片里既没有岗位链接也没有 JD：先拉一次站点自己的列表接口，
    // 按"卡片标题 === 接口 JobAdName"精确合并出 URL 与完整 JD；接口失败则该站扫描降级，不猜 URL
    let listByTitle = null;
    if (config.listJobs) {
      try { listByTitle = new Map((await config.listJobs()).map((item) => [item.title, item])); } catch (_) { listByTitle = new Map(); }
    }
    const cards = [...new Set(config.cards.flatMap((selector) => [...document.querySelectorAll(selector)]))];
    const cardSet = new Set(cards);
    // BOSS 的 li 启发式：选择器没覆盖到、但内部含岗位名容器的 li 也是卡片
    if (config.cardExtra) for (const el of document.querySelectorAll(config.cardExtra)) if (!cardSet.has(el) && el.querySelector("[class*='job-name'],[class*='job-title']")) { cards.push(el); cardSet.add(el); }
    const result = [];
    const companySelectors = [".cname", ".company-name", ".boss-name", "[class*='company']", "[class*='boss-name']"];
    // cardTitle/cardDescription 兼容字符串或数组（北森要同时覆盖新版与企业定制两套模板）；
    // cardCompany 兼容选择器或 (el) => 文本 的函数（定制模板公司名在"招聘单位："行里）
    const cardTitleSelectors = [...(Array.isArray(config.cardTitle) ? config.cardTitle : config.cardTitle ? [config.cardTitle] : []), config.cardLink, ".jname", ".title", ".job-name", ".job-title", "[class*='job-name']", "[class*='job-title']", "h3", "h2"].filter(Boolean);
    const cardDescriptionSelectors = Array.isArray(config.cardDescription) ? config.cardDescription : config.cardDescription ? [config.cardDescription] : [];
    for (const el of cards) {
      const link = config.cardLink ? el.querySelector(config.cardLink) : el.querySelector("a[href]");
      // a[href] 兜底可能命中 javascript: 伪协议（如北森定制卡里的"立即投递/收藏"），
      // 不能当岗位 URL，退回 listJobs 合并出的地址
      const linkUrl = link && /^https?:/i.test(link.href) ? new URL(link.href, location.href).href : "";
      const cardText = cleanText(el);
      const titleEl = first(cardTitleSelectors, el);
      const title = cleanText(titleEl) || cardText.slice(0, 100);
      const supplementary = listByTitle?.get(title);
      const cardUrl = config.cardUrl ? config.cardUrl(el) : linkUrl || supplementary?.url || "";
      // 没解析出岗位链接的"卡片"不是岗位：BOSS 的 li 启发式会把技能标签之类的容器也算进来，
      // 之前用 location.href 兜底，结果排名列表里混进「发表算法相关优秀论文」这种条目，
      // 而且这类条目共用同一个 url，saveJob 按 url 去重时会互相覆盖。
      if (!cardUrl || cardText.length < 10) continue;
      const companyText = typeof config.cardCompany === "function"
        ? config.cardCompany(el) || cleanText(first(companySelectors, el))
        : cleanText(config.cardCompany ? first([config.cardCompany], el) || first(companySelectors, el) : first(companySelectors, el));
      // 薪资只在卡片自身里找：原来会往上爬 8 层祖先，BOSS 列表页很多卡片写着"面议"，
      // 一爬就把隔壁卡片的薪资当成本卡片的。BOSS 还把薪资数字放在 CSS 生成内容里（文本节点只剩 "-K·薪"），
      // 取不到就留空，面板会显示"薪资待确认"——比显示一个错的数字诚实。
      result.push({ id: "job-" + Math.random().toString(36).slice(2), site, url: cardUrl, title, company: companyText || config.companyFrom?.() || "", location: supplementary?.location || cleanText(firstValid([".location", ".area", "[class*='city']"], isCityName, el)), salary: supplementary?.salary || salaryLeaf(el), description: supplementary?.description || cleanText(first(cardDescriptionSelectors, el)) || cardText, extractedAt: new Date().toISOString(), score: null, verdict: null, matched: [], missing: [], reasons: "", status: "scored", greeting: "", updatedAt: new Date().toISOString(), el });
    }
    // 同一岗位 URL 只留一条：Moka 同卡内外两个 <a> 的标题可能差个"急"徽标字，按
    // url|title|company 三元组去重收不掉；保留 JD 更长的那个（整卡链接的文本更全）。
    // saveJob 本来就按 url 去重，看板里同一岗位也只该有一行
    const byUrl = new Map();
    for (const item of result) {
      const existing = byUrl.get(item.url);
      if (!existing || item.description.length > existing.description.length) byUrl.set(item.url, item);
    }
    return [...byUrl.values()];
  };
  // navigate 深扫跳回列表后，判断卡片是否已经重新渲染出来
  api.listHasCards = () => {
    const config = siteConfig();
    return config.cards.some((selector) => { try { return Boolean(document.querySelector(selector)); } catch (_) { return false; } });
  };
})(globalThis);
