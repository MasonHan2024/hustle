const LOG_KEY = "log_history";
const STORAGE_KEY = "resume_response_cache";
const RESULT_KEY = "status_change_result";
const ISSUE_RESULT_KEY = "issue_status_change_result";

const resetBtn = document.getElementById("reset-btn");
const listenSwitch = document.getElementById("listen-switch");
const listenLabel = document.getElementById("listen-label");
const logBox = document.getElementById("log-box");
const resume_resultBox = document.getElementById("resume-result-box");
const issue_resultBox = document.getElementById("issue-result-box");  // ✅ NEW
const logswitch = document.getElementById("log-switch");
const clearResultsBtn = document.getElementById("clear-results");
const logTitle = document.getElementById("log-title");

resetBtn.addEventListener("click", async () => {
  await chrome.storage.local.clear();
  updateLogBox(["[初始化] 正在拉取候选人数据..."]);
  updateResumeResultBox([]);
  updateIssueResultBox([]);  // ✅ clear issue box too
  listenSwitch.checked = false;
  listenLabel.textContent = "🔇 监听未开启";

  chrome.runtime.sendMessage({ type: "STOP_BACKGROUND_FETCH" });
  chrome.runtime.sendMessage({ type: "RUN_INITIALIZER" });

  for (let i = 0; i < 5; i++) {
    setTimeout(refreshLogsAndResults, i * 1000);
  }
});

listenSwitch.addEventListener("change", () => {
  const on = listenSwitch.checked;
  if (on) {
    chrome.runtime.sendMessage({ type: "START_BACKGROUND_FETCH" });
    listenLabel.textContent = "🟢 正在监听状态变化";
  } else {
    chrome.runtime.sendMessage({ type: "STOP_BACKGROUND_FETCH" });
    listenLabel.textContent = "🔇 监听未开启";
  }
});

logswitch.addEventListener("change", () => {
  const visible = logswitch.checked;
  logBox.style.display = visible ? "block" : "none";
  logTitle.style.display = visible ? "block" : "none";
  chrome.storage.local.set({ logVisibility: visible });
});

clearResultsBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [RESULT_KEY]: [], [ISSUE_RESULT_KEY]: [] }); // ✅ clear both
  updateResumeResultBox([]);
  updateIssueResultBox([]);
});

async function refreshLogsAndResults() {
  const { [LOG_KEY]: logs = [], [RESULT_KEY]: results = [], [ISSUE_RESULT_KEY]: issueResults = [] } =
    await chrome.storage.local.get([LOG_KEY, RESULT_KEY, ISSUE_RESULT_KEY]);
  updateLogBox(logs);
  updateResumeResultBox(results);
  updateIssueResultBox(issueResults);  // ✅ update issue box too
}

function updateLogBox(logs) {
  logBox.innerText = logs.slice(-100).join("\n") || "暂无日志";
}

function updateResumeResultBox(results) {
  resume_resultBox.innerText = results.slice(-100).join("\n") || "暂无变化";
}

function updateIssueResultBox(results) {
  issue_resultBox.innerText = results.slice(-100).join("\n") || "暂无变化";  // ✅
}

chrome.runtime.onMessage.addListener((msg) => {
  if (
    msg.type === "PROGRESS_UPDATE" ||
    msg.type === "STATUS_CHANGE" ||
    msg.type === "ISSUE_STATUS_CHANGE" // ✅ refresh on issue change too
  ) {
    refreshLogsAndResults();
  }
});

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument?.();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: "Run initializer.js outside active tab"
    });
  }
}

setInterval(() => {
  refreshLogsAndResults();
}, 2000);

chrome.storage.local.get("backgroundPolling", ({ backgroundPolling }) => {
  const on = !!backgroundPolling;
  listenSwitch.checked = on;
  listenLabel.textContent = on ? "🟢 正在监听状态变化" : "🔇 监听未开启";
});

chrome.storage.local.get("logVisibility", ({ logVisibility = true }) => {
  logswitch.checked = logVisibility;
  logBox.style.display = logVisibility ? "block" : "none";
  logTitle.style.display = logVisibility ? "block" : "none";
});
