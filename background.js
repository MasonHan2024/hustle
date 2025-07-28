// ==================== CONSTANTS & FLAGS ====================
let isInitializerRunning = false;
let polling = false;
let isPollingRunning = false;

const DOMAIN = "xingchens-admin.jd.com";
const STORAGE_KEY = "resume_response_cache";
const LOG_KEY = "log_history";
const RESULT_KEY = "status_change_result";
const ISSUE_RESULT_KEY = "issue_status_change_result";

const resumeStatus_map = {
  0: "初筛中", 96: "初筛驳回", 2: "一面", 97: "一面驳回", 4: "二面", 98: "二面驳回",
  70: "待招采发起采购", 71: "待确认offer", 72: "待入场", 74: "已入场",
  61: "招采拒绝", 60: "异常入场", 88: "待业务员发起采购", 75: "终止采购",
  76: "offer变更审批中", 77: "岗位定薪待审批", 95: "未到场面试"
};

const approveStatus_map = {
  0: "已完成", 1: "招聘中", 2: "已拒绝", 3: "已暂停", 4: "待确认", 5: "已取消"
};

// ==================== UTILITIES ====================
async function getAuthCookieHeader() {
  const cookieList = await chrome.cookies.getAll({ domain: DOMAIN });
  return cookieList.map(c => `${c.name}=${c.value}`).join("; ");
}

async function authFetch(url, options = {}) {
  const cookieHeader = await getAuthCookieHeader();
  const headers = {
    ...options.headers,
    "Cookie": cookieHeader,
    "Content-Type": "application/json"
  };

  return fetch(url, {
    ...options,
    headers,
    credentials: "include"
  });
}

function sendLog(message) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${message}`;

  chrome.runtime.sendMessage({ type: "PROGRESS_UPDATE", message: entry });
  chrome.storage.local.get(LOG_KEY, (res) => {
    const history = res[LOG_KEY] || [];
    history.push(entry);
    chrome.storage.local.set({ [LOG_KEY]: history.slice(-300) });
  });
}

async function fetchIssueInfo(issueId) {
  const res = await authFetch(`https://${DOMAIN}/api/v1/outsource/queryIssueInfo?issueId=${issueId}`);
  const json = await res.json();
  return json.result;
}

async function fetchIssueList(pageNum, pageSize = 10) {
  const url = `https://${DOMAIN}/api/v1/outsource/queryIssues?pageNo=${pageNum}&pageSize=${pageSize}&approveStatus=1`;
  const res = await authFetch(url);
  const json = await res.json();
  return json.result?.list || [];
}

async function fetchCandidates(issueId) {
  const url = `https://${DOMAIN}/api/v1/outsource/queryRecommends?issueId=${issueId}`;
  const res = await authFetch(url);
  const json = await res.json();
  return json.result?.list.map(c => ({ id: c.id, name: c.name, resumeStatus: c.resumeStatus })) || [];
}

async function runInitializer() {
  if (isInitializerRunning) return;
  isInitializerRunning = true;
  sendLog("🔁 正在初始化候选人数据...");

  const allData = {};
  let page = 1;
  let totalCount = 0;

  while (true) {
    const issueList = await fetchIssueList(page);
    sendLog(`📄 第 ${page} 页共 ${issueList.length} 个岗位`);
    if (!issueList.length) break;

    const firstId = issueList[0]?.id;
    if (firstId && firstId in allData) {
      sendLog(`🚫 检测到分页重复（ISSUE ${firstId} 已存在），停止抓取`);
      break;
    }

    for (const item of issueList) {
      const issueId = item.id;
      const candidates = await fetchCandidates(issueId);
      totalCount += candidates.length;
      allData[issueId] = candidates;
      sendLog(`🧾 发现 ISSUE ${issueId}，状态为 ${approveStatus_map[item.approveStatus] || item.approveStatus}`);
      sendLog(`✅ 初始化 ISSUE ${issueId} 完成（${candidates.length} 条）`);
    }

    page++;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: allData });
  isInitializerRunning = false;
  sendLog(`📦 初始化完成，共抓取 ${Object.keys(allData).length} 个职位，${totalCount} 条候选人信息`);
}



// ==================== BACKGROUND POLLING (STRATEGY A) ====================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "checkUpdates") return;
  if (isPollingRunning) {
    sendLog("⏳ 上一次监听任务仍在运行中，跳过本次调用");
    return;
  }

  isPollingRunning = true;
  sendLog("🔁 开始监听任务（ 检查旧记录 + 检查新岗位）");

  const storage = await chrome.storage.local.get(STORAGE_KEY);
  const oldData = storage[STORAGE_KEY] || {};
  const newData = {};
  const candidateChanges = [];
  const issueChanges = [];

  // // Step 1: Check existing issues for status changes
  for (const issueId of Object.keys(oldData)) {
    const info = await fetchIssueInfo(issueId);
    const approveStatus = info.approveStatus;
    const jobTitle = info.post || "未知岗位";
    sendLog(`🔍 正在检查 ISSUEID = ${issueId}`);
    if (approveStatus !== 1) {
      const oldLabel = approveStatus_map[1];
      const newLabel = approveStatus_map[approveStatus] || approveStatus;
      issueChanges.push(`📌 ${issueId}【${jobTitle}】职位状态变更：${oldLabel} → ${newLabel}`);
      continue; // do not include this in newData
    }

    const candidates = await fetchCandidates(issueId);
    const newMap = Object.fromEntries(candidates.map(c => [c.id, c.resumeStatus]));
    const oldMap = oldData[issueId]?.reduce((acc, c) => (acc[c.id] = c.resumeStatus, acc), {}) || {};

    for (const cand of candidates) {
      const cid = cand.id;
      const name = cand.name || "未知";
      const newStatusLabel = resumeStatus_map[cand.resumeStatus] || cand.resumeStatus;

      if (!(cid in oldMap)) {
        // Log new candidate but don't notify
        sendLog(`🆕 新候选人 ${name}（${issueId}）状态：${newStatusLabel}`);
        // Add to local update map
        oldMap[cid] = cand.resumeStatus;
      } else if (oldMap[cid] !== cand.resumeStatus) {
        const oldLabel = resumeStatus_map[oldMap[cid]] || oldMap[cid];
        candidateChanges.push(`📌 ${issueId}, ${jobTitle}：${name}，${oldLabel} → ${newStatusLabel}`);
        oldMap[cid] = cand.resumeStatus;
      }
    }
    newData[issueId] = Object.entries(oldMap).map(([id, resumeStatus]) => ({
      id: Number(id),
      name: candidates.find(c => c.id === Number(id))?.name || "未知",
      resumeStatus
    }));
  }

  // Step 2: Find new issues
  let page = 1;
  sendLog("📦 正在检查新职位");

  while (true) {
    const issueList = await fetchIssueList(page);
    if (!issueList.length) break;

    const firstId = issueList[0]?.id;
    if (firstId && (firstId in oldData || firstId in newData)) {
      sendLog(`🚫 检测到分页重复（ISSUE ${firstId} 已存在），停止抓取`);
      break;
    }

    for (const item of issueList) {
      const issueId = item.id;
      const jobTitle = item.post || "未知职位";
      sendLog(`🔍 检查新职位 ${issueId}【${jobTitle}】`);

      if (issueId in oldData) {
        sendLog(`⏭️ ${issueId} 已存在于旧数据中，跳过`);
        continue;
      }

      issueChanges.push(`🆕 新增职位 ${issueId}: ${jobTitle}`);

      const candidates = await fetchCandidates(issueId);
      sendLog(`👥 ${issueId} 有 ${candidates.length} 位候选人`);

      candidates.forEach(c => {
        const name = c.name || "未知";
        const statusLabel = resumeStatus_map[c.resumeStatus] || c.resumeStatus;
        candidateChanges.push(`🆕 候选人 ${name}（${issueId}）状态：${statusLabel}`);
      });

      newData[issueId] = candidates;
    }

    page++;
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: newData });

  if (candidateChanges.length) {
    const { [RESULT_KEY]: prevRes = [] } = await chrome.storage.local.get(RESULT_KEY);
    await chrome.storage.local.set({ [RESULT_KEY]: prevRes.concat(candidateChanges).slice(-100) });
    candidateChanges.forEach(msg =>
      chrome.notifications.create({ type: "basic", iconUrl: "icons/icon.png", title: "候选人状态变更", message: msg })
    );
  }

  if (issueChanges.length) {
    const { [ISSUE_RESULT_KEY]: prevIssues = [] } = await chrome.storage.local.get(ISSUE_RESULT_KEY);
    await chrome.storage.local.set({ [ISSUE_RESULT_KEY]: prevIssues.concat(issueChanges).slice(-100) });
    issueChanges.forEach(msg =>
      chrome.notifications.create({ type: "basic", iconUrl: "icons/icon.png", title: "职位状态变更", message: msg })
    );
  }

  sendLog(`✅ 更新完成（候选人变更 ${candidateChanges.length} 条，职位变更 ${issueChanges.length} 条）`);
  isPollingRunning = false;
});

// ==================== MESSAGE HANDLERS ====================
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg.type === "START_BACKGROUND_FETCH" && !polling) {
    polling = true;
    chrome.alarms.create("checkUpdates", { periodInMinutes: 60});
    chrome.storage.local.set({ backgroundPolling: true });
    sendLog("⏰ 已启动定时监听");
  }

  if (msg.type === "STOP_BACKGROUND_FETCH" && polling) {
    polling = false;
    chrome.alarms.clear("checkUpdates");
    chrome.storage.local.set({ backgroundPolling: false });
    sendLog("🛑 已停止定时监听");
  }

  if (msg.type === "RUN_INITIALIZER") {
    sendLog("⚙️ 手动初始化触发中...");
    runInitializer();
  }
});