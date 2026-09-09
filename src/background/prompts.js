// 求职类型影响硬门槛判断（实习看到岗时长、校招看毕业年份、社招看工作年限），必须显式告诉模型。
// career-change/soe 的硬门槛口径与 intern/campus/social 不同：转行不按对口年限封顶，国企事业单位看编制与流程。
const JOB_TYPE_LABELS = { intern: "日常实习", summer: "暑期实习", campus: "校园招聘（应届）", social: "社会招聘（有经验）", parttime: "兼职", career: "转行求职", soe: "国企事业单位" };
// 转行/国企求职的硬门槛判断逻辑特殊，值得单独告诉模型一句，避免被"年限不符"误杀
const JOB_TYPE_NOTES = {
  career: "候选人属于转行求职：原领域年限不能直接算作目标领域年限，方向与方法上的可迁移性是主要评分依据，不要因年限不足直接判硬门槛不满足。",
  soe: "候选人目标为国企/事业单位：稳定性、政治面貌、证书与编制流程相关的门槛按 JD 原文判断，不要用市场化公司的偏好（如年龄歧视、大厂背景）加分减分。"
};
// BOSS/实习僧/牛客/智联扫描时会读到完整 JD，截太短会丢掉“任职要求”（学历/年限/技术栈硬门槛都在那里）；51job、应届生等只有卡片摘要，无需放宽
const FULL_JD_SITES = new Set(["zhipin", "shixiseng", "nowcoder", "zhaopin"]);
const clip = (value, limit) => {
  const text = String(value || "");
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
};
// 领域侧写：核心能力维度 + 该领域的资历口径 + 常见硬门槛。
// AI/软件沿用原来的维度清单（AI 岗评分精度不降）；其他领域各写一段，覆盖批量扫描会丢在摘要阶段的关键信息。
const DOMAIN_PROFILES = {
  ai: {
    label: "AI / 软件 / 互联网",
    brief: "AI/LLM 与软件工程方向：大模型算法与应用、RAG、Agent/多智能体、Post-training、多模态、后端/数据/平台工程。",
    dimensions: "方向与方法匹配（SFT/DPO/GRPO/RLHF、RAG/检索增强、Agent/多智能体、推理与 Post-training、多模态、后端/数据/平台工程）、论文与竞赛（CCF 等级、顶会 ACL/NeurIPS/ICLR/ICML、Kaggle/天池）、工程栈（PyTorch、vLLM、DeepSpeed、ms-swift、verl、LangChain/LangGraph、MCP、云原生与分布式）、学历与年限硬门槛、业务场景贴合度、地点与到岗时间",
    seniority: "论文/竞赛等级、开源项目影响力、实习与项目年限"
  },
  product: {
    label: "产品 / 运营 / 市场",
    brief: "产品经理、用户/内容/活动/电商运营、市场营销与增长方向。",
    dimensions: "产品方法论（需求洞察、PRD 与原型、数据驱动迭代）、运营能力（用户增长、活动策划、内容运营、私域转化、GMV/DAU/留存等量化指标）、市场能力（品牌、投放 ROI、渠道）、行业理解与用户研究、工具栈（Axure/SQL/表格/BI/投放平台）、学历与年限硬门槛、地点与到岗时间",
    seniority: "主导过的产品线/项目规模、量化业绩（GMV/增长率/留存）、带团队与跨部门协作年限"
  },
  finance: {
    label: "金融 / 财会 / 法务",
    brief: "金融（券商/基金/银行/保险）、财务会计、审计、法务合规方向。",
    dimensions: "专业资质（CPA/CFA/FRM/法律职业资格/证券从业等证书）、专业能力（估值建模、财务分析、审计底稿、合同审查、合规风控）、行业经验（一二级市场、行业赛道、IPO/并购项目）、量化业绩（管理的资产规模、回款、项目金额）、学历（金融/财会/法学target school 加权明显）与年限硬门槛、语言能力、地点与到岗时间",
    seniority: "证书资质、项目类型与金额、管理资产/回款规模、事务所或金融机构年限"
  },
  design: {
    label: "设计 / 创意",
    brief: "UI/UX、视觉、平面、工业、服装、游戏美术等设计方向。",
    dimensions: "作品集质量与匹配度（风格、品类、完整项目案例）、设计工具与方法（Figma/Sketch/Adobe 全家桶、设计系统、可用性测试）、行业与品类经验（电商/B 端/游戏/品牌）、量化成果（转化率提升、组件库覆盖、验收通过率）、学历与年限硬门槛、地点与到岗时间",
    seniority: "作品集与主页链接、代表项目、服务过的客户/品牌"
  },
  medical: {
    label: "医疗 / 护理 / 生物",
    brief: "医生、护理、药学、医学检验、临床研究、生物医药研发方向。",
    dimensions: "执业资质与证书（执业医师/护士资格/药师/临床试验 GCP 等，缺证直接是硬门槛）、专业方向与科室/疾病领域匹配、临床或科研经验（病例数、试验项目、论文）、规范化培训与轮转要求、学历（医学对学历门槛极敏感）与年限硬门槛、夜班/值班承受度、地点与到岗时间",
    seniority: "执业资质、规培完成情况、科室年限、科研产出"
  },
  sales: {
    label: "销售 / 商务 / 客户成功",
    brief: "大客户/渠道/KA 销售、商务拓展（BD）、客户成功与售后方向。",
    dimensions: "销售能力（成单业绩、客单价与签单额、渠道开拓、谈判与回款）、行业资源与人脉（对应行业的客户资源直接加分）、客户成功（续约率、满意度、NPS）、语言能力（外贸岗）、学历与年限硬门槛、出差与驻外意愿、地点与到岗时间",
    seniority: "签单额与回款的量化业绩、带教与团队规模、行业年限"
  },
  manufacturing: {
    label: "制造 / 工程 / 供应链",
    brief: "机械/电气/化工/工艺工程师、生产制造、质量管理、供应链与物流方向。",
    dimensions: "工程能力（工艺设计、设备维护、产线规划、CAD/CAE 工具）、质量体系（ISO/IATF16949/六西格玛等）、供应链（采购、计划、库存周转、降本量化）、安全与资质（特种作业证、注册安全工程师等）、学历（工科对口专业）与年限硬门槛、驻厂/出差意愿、地点与到岗时间",
    seniority: "项目规模与降本增效量化、体系认证经验、工厂/产线年限"
  },
  education: {
    label: "教育 / 培训 / 科研",
    brief: "教师、教研、培训讲师、高校科研与行政方向。",
    dimensions: "教学能力（学科对口、授课风格、课程设计与教研成果）、资质证书（教师资格证、普通话等级、学科竞赛获奖）、科研能力（论文、课题、基金）、学员成果与量化指标（提分率、完课率、口碑）、学段与学科匹配、学历（学校与专业对口敏感）与年限硬门槛、地点与到岗时间",
    seniority: "带过的学段/学科、学员成绩与续班率、课题与论文"
  },
  hr: {
    label: "人力资源 / 行政 / 通用职能",
    brief: "HR（招聘/培训/薪酬绩效/HRBP）、行政、文秘、其他通用职能方向。",
    dimensions: "模块能力（招聘到岗周期与漏斗数据、培训体系搭建、薪酬绩效设计、员工关系与劳动法）、行政能力（流程建设、资产管理、活动组织）、语言与文书能力、量化成果（HC 完成率、人均效能、成本节约）、学历与年限硬门槛、地点与到岗时间",
    seniority: "模块深度、服务过的组织规模、体系化建设成果"
  },
  generic: {
    label: "通用（未指定领域）",
    brief: "未指定具体行业时按通用职业能力评估。",
    dimensions: "岗位核心职责与候选人经验的直接对应关系、可迁移的关键能力（方法/工具/流程）、量化成果与证据（业绩数字、项目规模、作品）、学历与证书等资质门槛、语言与沟通能力、地点与到岗时间",
    seniority: "相关经验年限、量化成果、资质证书"
  }
};
const domainOf = (profile) => DOMAIN_PROFILES[profile.domain] || DOMAIN_PROFILES.generic;
const profileText = (profile) => [
  `求职类型：${JOB_TYPE_LABELS[profile.jobType] || profile.jobType || "未指定"}`,
  `目标领域：${domainOf(profile).label}`,
  `目标岗位：${profile.targetRoles || "未填写"}`,
  `技能与专长：${profile.skills || "未填写"}`,
  `期望城市：${profile.preferredCities || "未填写"}`,
  ...(profile.education ? [`教育背景：${profile.education}`] : []),
  ...(profile.certificates ? [`证书资质：${profile.certificates}`] : []),
  ...(profile.expectedSalary ? [`期望薪资下限：${profile.expectedSalary}`] : []),
  ...(profile.extraNotes ? [`补充偏好：${profile.extraNotes}`] : []),
  `简历：\n${profile.resumeText || "未填写"}`
].join("\n");
const jobText = (job) => JSON.stringify({
  title: job.title, company: job.company, location: job.location,
  salary: job.salary, description: clip(job.description, 4000)
}, null, 2);
const batchJobText = (job, index) => `${index}. ${JSON.stringify({
  title: job.title, company: job.company, location: job.location,
  salary: job.salary, description: clip(job.description, FULL_JD_SITES.has(job.site) ? 2200 : 800)
}, null, 2)}`;
// 锚点措辞刻意领域无关（"关键能力/核心方法"、"同一个职能大类"）：锚点是分数的共同标尺，
// 同一批岗位要能横向比较，任何行业的人都不该因为措辞读不懂而整体落错档。
const SCORE_ANCHORS = [
  "评分锚点（先判断硬门槛，再看方向与关键能力；硬门槛不满足时不得给高分）：",
  "- 90-100：方向与核心方法高度对口，硬门槛全部满足，且有可直接迁移的项目、资质或成果。",
  "- 75-89：方向对口、硬门槛满足，仅缺 1-2 项次要能力/工具或经验略浅。",
  "- 50-74：同一个职能大类但核心方法不同（如同类岗位里不同的专业方向/业务线），或硬门槛勉强满足需额外说明。",
  "- 25-49：方向偏离较多，或缺多项关键能力。",
  "- 0-24：硬门槛不满足——无论其他方面多亮眼都不得高于 24。",
  "硬门槛随求职类型变化：实习看可实习时长与每周到岗天数；校招看毕业年份与学历；社招看工作年限、职级与领域经验；转行求职按可迁移性评估，不按原领域年限直接判不满足。地点、学历、年限、执业资质明显不符且无可协商空间时按硬门槛处理。"
].join("\n");
export function buildResumeSummaryPrompt(resumeText) {
  return {
    // 摘要是批量扫描唯一的简历输入：证书资质、量化业绩、作品集链接、语言能力这些非技术岗的关键信号
    // 必须在压缩阶段保住，否则之后每一条分数都建立在残缺输入上，用户还察觉不到。
    system: "你是简历信息压缩助手，输出结果将用于岗位批量初筛，候选人可能来自任何行业。只保留能用于判断岗位匹配度的客观事实，不评价、不编造、不补充简历中没有的内容。\n输出纯文本，不超过 400 字，按以下顺序分行，每行用「类别：内容」格式：学历与毕业时间｜专业与研究方向｜证书与执业资质｜核心技能与工具｜业绩与量化成果（GMV/回款/提分率/项目规模等）｜代表性项目｜论文/竞赛/作品集｜工作或实习年限｜语言能力。简历中没有的类别整行写「未提及」，不要留空行。",
    user: `简历全文：\n${clip(resumeText, 8000)}`
  };
}
export function buildScorePrompt(profile, job) {
  const domain = domainOf(profile);
  const typeNote = JOB_TYPE_NOTES[profile.jobType] || "";
  return {
    system: `你是一名资深招聘顾问与求职教练，专注${domain.label}方向，服务对象覆盖实习、校招与社招求职者。结合候选人画像与岗位 JD 判断契合度，只依据提供的信息，不要臆测。\n领域侧写：${domain.brief}\n评估维度：${domain.dimensions}。资历口径：${domain.seniority}。\n${SCORE_ANCHORS}\n${typeNote}\nverdict 与 score 必须一致：≥75 为 recommend，50-74 为 consider，<50 为 skip。\n只输出一个 JSON 对象，不要任何 JSON 之外的文字、不要 Markdown 代码块。字段与类型严格如下：\n{"score": <0-100 的整数>, "verdict": "recommend"|"consider"|"skip", "matched": ["≤3 条命中点，每条 ≤20 字"], "missing": ["≤3 条缺失/风险点，每条 ≤20 字"], "reasons": "一句话结论，≤60 字", "advice": "1-2 句可执行求职建议，≤120 字：投递策略、简历如何强调、面试准备方向或该岗位的风险提示"}`,
    user: `候选人画像：\n${profileText(profile)}\n\n岗位信息：\n${jobText(job)}`
  };
}
export function buildBatchScorePrompt(profile, jobs) {
  const domain = domainOf(profile);
  const typeNote = JOB_TYPE_NOTES[profile.jobType] || "";
  return {
    system: `你是资深${domain.label}方向的招聘顾问，服务对象覆盖实习、校招与社招求职者。逐一判断候选人与每个岗位 JD 的契合度，只依据提供的信息，不要臆测。\n领域侧写：${domain.brief}\n评估维度：${domain.dimensions}。\n候选人简历以压缩摘要形式给出，属正常情况，不要因为摘要简短而扣分。若某个岗位的描述明显只是列表摘要（只有技能标签或一两句话），按已知信息评估，不要因为信息缺失而扣分，也不要把“信息不足”写进 missing。\n${SCORE_ANCHORS}\n${typeNote}\nscore 必须是 0-100 的整数，不能用 0-10 等其他尺度。同一批岗位应按契合度拉开差距，不要给出雷同分数。verdict 必须与 score 一致：75-100 为 recommend，50-74 为 consider，0-49 为 skip。\n为节省输出与时间：不要输出 reasons 与 advice 字段，matched/missing 每个岗位最多 2 条且每条 ≤15 字。\n只输出一个 JSON 对象，不要任何 JSON 之外的文字、不要 Markdown 代码块。格式严格如下：\n{"results":[{"i":0,"score":0,"verdict":"recommend|consider|skip","matched":[],"missing":[]}]}\nresults 必须覆盖每个岗位索引，i 与输入编号一致。`,
    user: `候选人画像：\n${profileText(profile)}\n\n岗位列表：\n${jobs.map((job, index) => batchJobText(job, index)).join("\n")}`
  };
}
export function buildGreetingPrompt(profile, job, hint = "") {
  const matched = Array.isArray(job.matched) ? job.matched.filter(Boolean) : [];
  const domain = domainOf(profile);
  // LinkedIn 上默认收英文招呼（招聘方多用英文沟通），其他站保持中文；用户在 hint 里指定语言时以用户为准
  const english = job.site === "linkedin";
  return {
    system: english
      ? `You are a job-seeking assistant. Write as the candidate (first person) reaching out to a recruiter or hiring manager on LinkedIn: a brief expression of interest in the role, one concrete matching point drawn strictly from the provided profile (a qualification, a quantified achievement, a project or portfolio), and a request to continue the conversation. 2-3 short sentences, under 60 words, single paragraph, no subject line, no Markdown, never invent experience.`
      : `你是求职沟通助手。你就是求职者本人，用第一人称向招聘方或 HR 打招呼，简短自荐，表达对岗位的兴趣，并请求进一步沟通。\n写一段适合在招聘平台（BOSS 直聘、实习僧等）站内直接发送的中文打招呼语：2-3 句短句，约 60-90 字，硬上限 100 字，单段，不要称呼标题，不要 Markdown。\n必须提到 1 个与该岗位最相关的具体匹配点（优先用已识别的匹配点；也可以是${domain.label}方向的代表性资质、量化业绩、项目或作品），不编造经历。语气真诚温和，不夸大。`,
    user: `候选人画像：\n${profileText(profile)}\n\n岗位信息：\n${jobText(job)}${matched.length ? `\n\n已识别的匹配点：${matched.join("；")}（请优先围绕其中最有说服力的一条展开，保持与上面这些点一致）` : ""}${hint ? `\n\n用户额外要求：${hint}（在遵守简短要求的前提下尽量满足，包括语言要求）` : ""}`
  };
}
