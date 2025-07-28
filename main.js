const navButtons = document.querySelectorAll('.nav-btn');
const panels = document.querySelectorAll('.content-panel');
let forexChart = null;
let currentCurrency = 'cny';  // default
let companyChart = null;

const newsCurrencyLabels = {
  cny: "人民币/美元",
  cnh: "人民币/美元",  // deliberately same
  jpy: "日元/美元",
  twd: "新台币/美元"
};

const otherCurrencyLabels = {
  cny: "人民币/美元",
  cnh: "离岸人民币/美元",  // different!
  jpy: "日元/美元",
  twd: "新台币/美元"
};

window.addEventListener('DOMContentLoaded', async () => {
  setupNav();
  setupCurrencyNav();
  await loadAllPanels();
  
});

function getActionClass(action) {
  if (action === "Buy") return "buy";
  if (action === "Sell") return "sell";
  return "neutral";
}

function setupCurrencyNav() {
  const currencyBtns = document.querySelectorAll('.currency-btn');
  currencyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      currencyBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency = btn.dataset.currency;
      await loadAllPanels();  // reload everything for new currency
    });
  });
}

function setupNav() {
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Skip if button is hidden
      if (btn.classList.contains('hidden')) return;
      
      navButtons.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
    });
  });
}

function updateCurrencyLabels() {
  const newsLabel = newsCurrencyLabels[currentCurrency] || "";
  const otherLabel = otherCurrencyLabels[currentCurrency] || "";

  document.getElementById("currency-label-news").textContent = newsLabel + " ";
  document.getElementById("currency-label-graph").textContent = otherLabel + " ";
  document.getElementById("currency-label-analysis").textContent = otherLabel + " ";
}

async function loadAllPanels() {
  
  updateCurrencyLabels();

  const allNavButtons = document.querySelectorAll('.nav-btn');
  const allPanels     = document.querySelectorAll('.content-panel');

  // panels you want in “company” mode:
  const companyPanels = [
    'companyByMonth',
    'companyByCurrency',
    'uploadRatesPanel'     // ← add it here
  ];

  if (currentCurrency === 'company') {
    // show only the company panels / buttons
    allNavButtons.forEach(btn => {
      btn.classList[
        companyPanels.includes(btn.dataset.panel) ? 'remove' : 'add'
      ]('hidden');
    });
    allPanels.forEach(panel => {
      panel.classList[
        companyPanels.includes(panel.id) ? 'remove' : 'add'
      ]('hidden');
      panel.classList.remove('active');
    });

    // activate a default tab
    document.querySelector('.nav-btn[data-panel="companyByMonth"]')
      .classList.add('active');
    document.getElementById('companyByMonth').classList.add('active');

    // load your data & wire up the form
    await loadCompanyData();
    await loadCompanyCurrencyData();
    setupUploadForm();  // if you have any JS hooking into the form
  } else {
    // Hide company nav buttons and panels for non-company currencies
    allNavButtons.forEach(btn => {
      if (companyPanels.includes(btn.dataset.panel)) {
        btn.classList.add('hidden');
      } else {
        btn.classList.remove('hidden');
      }
    });

    // Hide company panels
    allPanels.forEach(panel => {
      if (companyPanels.includes(panel.id)) {
        panel.classList.remove('active');
        panel.classList.add('hidden');
      } else {
        panel.classList.remove('hidden');
      }
    });

    // Activate the first regular panel by default
    document.querySelector('.nav-btn[data-panel="newsPanel"]').classList.add('active');
    document.getElementById('newsPanel').classList.add('active');

    // Load regular currency data
    loadNews();
    await drawForexChart();
    await loadAIAnalysis();
    await loadIndicators();
  }
}
function setupCurrencyNav() {
  const currencyBtns = document.querySelectorAll('.currency-btn');
  currencyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      currencyBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCurrency = btn.dataset.currency;
      await loadAllPanels();  // reload everything for new currency
    });
  });
}
document.addEventListener('DOMContentLoaded', loadNews);

function loadNews() {
  fetch(`data/${currentCurrency}/news.json`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => renderNews(data, 'news-list'))
    .catch(err => {
      console.error('加载新闻失败:', err);
      document.getElementById('news-list').innerHTML = '<p>加载新闻失败</p>';
    });
}

function renderNews(items, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';  // clear

  if (!items.length) {
    container.innerHTML = '<p>暂无新闻</p>';
    return;
  }

  items.forEach(n => {
    // strip quotes/spaces just in case
    const type = (n.type || '').replace(/['"]/g, '').trim();
    // decide prefix
    let prefix = '';
    if (type === '央行') prefix = '央行 – ';
    else if (type === '离岸') prefix = '离岸 – ';

    const item = document.createElement('div');
    item.className = 'news-item';
    item.innerHTML = `
      <a href="${n.link}" target="_blank">${prefix}${n.title}</a>
      <div class="date">${n.time}</div>
    `;
    container.appendChild(item);
  });
}


async function drawForexChart() {
  const res = await fetch(`data/${currentCurrency}/data.json`);
  const predictionRes = await fetch(`data/${currentCurrency}/predictions.json`);

  const data = await res.json();
  const predictions = (await predictionRes.json()).predictions || [];

  // Extract close prices and dates
  const parsedClose = data.map(d => ({ x: new Date(d.date), y: d.close }));

  // Find local minima/maxima for labeling
  const localExtrema = [];
  for (let i = 1; i < parsedClose.length - 1; i++) {
    const prev = parsedClose[i - 1].y;
    const curr = parsedClose[i].y;
    const next = parsedClose[i + 1].y;
    const isMin = curr < prev && curr < next;
    const isMax = curr > prev && curr > next;
    if (isMin || isMax) {
      localExtrema.push({ x: parsedClose[i].x, y: curr });
    }
  }

  // Prediction line
  const predictionLine = predictions.map(p => ({ x: new Date(p.date), y: p.mean }));
  const minLine = predictions.map(p => ({ x: new Date(p.date), y: p.lower }));
  const maxLine = predictions.map(p => ({ x: new Date(p.date), y: p.upper }));

  const ctx = document.getElementById('forexChart').getContext('2d');
  if (forexChart) forexChart.destroy();

  forexChart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Close Price',
          data: parsedClose,
          borderColor: '#4ca1af',
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Forecast (mean)',
          data: predictionLine,
          borderColor: 'orange',
          borderDash: [5, 5],
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Forecast Min',
          data: minLine,
          borderColor: 'green',
          borderDash: [2, 4],
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Forecast Max',
          data: maxLine,
          borderColor: 'red',
          borderDash: [2, 4],
          tension: 0.1,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true },
        tooltip: { mode: 'index', intersect: false },
        annotation: {
          annotations: localExtrema.map((e, i) => ({
            type: 'label',
            xValue: e.x,
            yValue: e.y,
            backgroundColor: 'rgba(0,0,0,0.6)',
            content: e.y.toFixed(4),
            font: { size: 10 },
            enabled: true
          }))
        }
      },
      scales: {
        x: { type: 'time', time: { unit: 'day' } },
        y: {
          position: 'left',
          title: { display: true, text: 'Price' },
          ticks: { callback: v => v.toFixed(4) }
        }
      }
    }
  });
}

async function loadAIAnalysis() {
  const res = await fetch(`data/${currentCurrency}/analysis.json`);
  const data = await res.json();
  const raw = data[0]?.text || '';

  // 提取每段内容
  const sections = {};
  const matches = raw.matchAll(/####\s*[一二三四]\s*、?(.+?)\n([\s\S]*?)(?=####|$)/g);
  
  for (const match of matches) {
    const title = match[1].trim();
    const content = match[2].trim();

    if (title.includes('移动平均')) sections.ma = content;
    else if (title.includes('枢轴')) sections.pivot = content;
    else if (title.includes('技术指标')) sections.ti = content;
    else if (title.includes('综合')) sections.combined = content;
  }

  // 注入对应的 div
  document.getElementById('ma-analysis').innerText = sections.ma || '暂无分析';
  document.getElementById('ti-analysis').innerText = sections.ti || '暂无分析';
  document.getElementById('pivot-analysis').innerText = sections.pivot || '暂无分析';
  document.getElementById('combined-analysis').innerText = sections.combined || '暂无分析';
}

async function loadIndicators() {
  const res = await fetch(`data/${currentCurrency}/tech.json`);
  const data = await res.json();
  const indicators = data[0];  // Assuming one item in the array
  
  // Populate Moving Averages Table
  populateMovingAverages(indicators.moving_averages);
  
  // Populate Pivot Points Table
  populatePivotPoints(indicators.pivot_points);
  
  // Populate Technical Indicators Table
  populateTechnicalIndicators(indicators.technical_indicators);
}

function populateMovingAverages(movingAverages) {
  const table = document.getElementById('moving-averages-table');
  let rows = `<thead>
                <tr>
                  <th>名称</th>
                  <th colspan="2">Simple</th>
                  <th colspan="2">Exponential</th>
                </tr>
                <tr>
                  <th></th>
                  <th>值</th><th>动作</th>
                  <th>值</th><th>动作</th>
                </tr>
              </thead>
              <tbody>`;

  let buyCount = 0, sellCount = 0;

  movingAverages.forEach(ma => {
    const simpleClass = getActionClass(ma.simple_action);
    const expClass = getActionClass(ma.exp_action);

    if (ma.simple_action === "Buy") buyCount++;
    if (ma.simple_action === "Sell") sellCount++;
    if (ma.exp_action === "Buy") buyCount++;
    if (ma.exp_action === "Sell") sellCount++;

    rows += `<tr>
               <td>${ma.name}</td>
               <td>${ma.simple_value}</td>
               <td class="${simpleClass}">${ma.simple_action}</td>
               <td>${ma.exp_value}</td>
               <td class="${expClass}">${ma.exp_action}</td>
             </tr>`;
  });

  rows += `</tbody>`;
  table.innerHTML = rows;

  // Append summary
  const summaryDiv = document.getElementById('ma-summary');
  summaryDiv.textContent = `总结: Buy: ${buyCount}, Sell: ${sellCount}`;

}

function populatePivotPoints(pivotPoints) {
  const table = document.getElementById('pivot-points-table');
  let rows = `<thead>
                <tr>
                  <th>Name</th>
                  <th>S3</th>
                  <th>S2</th>
                  <th>S1</th>
                  <th>Pivot</th>
                  <th>R1</th>
                  <th>R2</th>
                  <th>R3</th>
                </tr>
              </thead>
              <tbody>`;

  pivotPoints.forEach(pivot => {
    rows += `<tr>
               <td>${pivot.name}</td>
               <td>${pivot.S3}</td>
               <td>${pivot.S2}</td>
               <td>${pivot.S1}</td>
               <td>${pivot.Pivot}</td>
               <td>${pivot.R1}</td>
               <td>${pivot.R2}</td>
               <td>${pivot.R3}</td>
             </tr>`;
  });

  rows += `</tbody>`;
  table.innerHTML = rows;
}

function populateTechnicalIndicators(indicators) {
  const table = document.getElementById('technical-indicators-table');
  let rows = `<thead>
                <tr>
                  <th>名称</th>
                  <th>值</th>
                  <th>动作</th>
                </tr>
              </thead>
              <tbody>`;

  let buyCount = 0, sellCount = 0;

  indicators.forEach(ind => {
    const actionClass = getActionClass(ind.action);
    if (ind.action === "Buy") buyCount++;
    if (ind.action === "Sell") sellCount++;

    rows += `<tr>
               <td>${ind.name}</td>
               <td>${ind.value}</td>
               <td class="${actionClass}">${ind.action}</td>
             </tr>`;
  });

  rows += `</tbody>`;
  table.innerHTML = rows;

  // Append summary
  const summaryDiv = document.getElementById('ti-summary');
  summaryDiv.textContent = `总结: Buy: ${buyCount}, Sell: ${sellCount}`;
}

async function loadCompanyData() {
  try {
    const response = await fetch('data/company_data.json');
    const data = await response.json();
    
    // Populate month dropdown
    populateMonthDropdown(data);
    
    // Display data for the first month by default
    if (data.length > 0) {
      displayMonthData(data, data[0].yearMonth);
    }
    
    // Add event listener for month selection
    document.getElementById('monthSelect').addEventListener('change', (e) => {
      displayMonthData(data, e.target.value);
    });
  } catch (error) {
    console.error('Error loading company data:', error);
    document.getElementById('company-monthly-table-container').innerHTML = 
      '<p>无法加载公司汇率数据</p>';
  }
}

function populateMonthDropdown(data) {
  const monthSelect = document.getElementById('monthSelect');
  monthSelect.innerHTML = '';
  
  // Extract unique months from data
  const months = [...new Set(data.map(item => item.yearMonth))].sort();
  
  months.forEach(month => {
    const option = document.createElement('option');
    option.value = month;
    option.textContent = month;
    monthSelect.appendChild(option);
  });
}
function displayMonthData(data, yearMonth) {
  // Filter data for selected month
  const monthData   = data.filter(item => item.yearMonth === yearMonth);
  const bookingData = monthData.find(item => item.kind === 'booking');
  const endingData  = monthData.find(item => item.kind === 'ending');

  displayCombinedRatesTable(bookingData, endingData, 'combined-rates-table');
}

function displayCombinedRatesTable(booking, ending, containerId) {
  const container = document.getElementById(containerId);
  if (!booking || !booking.rates) {
    container.innerHTML = '<p>无可用数据</p>';
    return;
  }

  // build a map of ending rates by currency
  const endMap = new Map(
    (ending?.rates || []).map(r => [r.currency, r])
  );

  // table header with 6 columns
  let html = `
    <table>
      <thead>
        <tr>
          <th>货币</th>
          <th>地区</th>
          <th>Booking NTD</th>
          <th>Booking USD</th>
          <th>Ending Monthly</th>
          <th>Ending YTD</th>
        </tr>
      </thead>
      <tbody>
  `;

  booking.rates.forEach(b => {
    const e = endMap.get(b.currency) || {};
    html += `
      <tr>
        <td>${b.currency}</td>
        <td>${b.country || '-'}</td>
        <td>${b.ntd    != null ? b.ntd.toFixed(4)    : '-'}</td>
        <td>${b.usd    != null ? b.usd.toFixed(4)    : '-'}</td>
        <td>${e.monthly != null ? e.monthly.toFixed(4) : '-'}</td>
        <td>${e.ytd     != null ? e.ytd.toFixed(4)     : '-'}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

// main.js
let companyData = [];

// 1) load data & init dropdown + chart
async function loadCompanyCurrencyData() {
  const resp = await fetch('data/company_data.json');
  companyData = await resp.json();

  // get currencies from the first booking block
  const booking = companyData.find(m => m.kind === 'booking' && Array.isArray(m.rates));
  const currencies = booking
    ? booking.rates.map(r => r.currency)
    : [];

  populateCurrencyDropdown(currencies);

  // draw default
  if (currencies.length) {
    drawForCurrency(currencies[0]);
  }

  // redraw on change
  document.getElementById('currencySelect')
    .addEventListener('change', e => drawForCurrency(e.target.value));
}

function populateCurrencyDropdown(currencies) {
  const sel = document.getElementById('currencySelect');
  sel.innerHTML = currencies
    .filter(c => c !== 'NTD')
    .map(c => `<option value="${c}">${c}</option>`)
    .join('');
}

function extractDataSeries(currency) {
  const points = [];

  companyData.forEach(m => {
    // only look at booking blocks
    if (m.kind !== 'booking' || !Array.isArray(m.rates)) return;

    const rate = m.rates.find(r => r.currency === currency);
    if (!rate || rate.usd == null) return;

    // ⚡ only USD, drop NTD / ending entirely
    points.push({
      date:   m.yearMonth,
      series: 'USD',
      value:  rate.usd
    });
  });

  return points;
}

// 3) draw chart for currency
function drawForCurrency(currency) {
  const raw = extractDataSeries(currency);
  console.log(`raw points for ${currency}:`, raw);

  // gather all months in sorted order
  const labels = Array.from(new Set(raw.map(p => p.date)))
    .sort();

  // one dataset per series
  const seriesNames = [...new Set(raw.map(p => p.series))];
  const datasets = seriesNames.map(name => {
    // map date→value for quick lookup
    const map = new Map(raw
      .filter(p => p.series === name)
      .map(p => [p.date, p.value])
    );

    // build data array aligned to labels
    const data = labels.map(lbl => map.has(lbl) ? map.get(lbl) : null);

    return {
      label: `${currency} ${name}`,
      data,
      tension: 0.1
    };
  });

  const ctx = document.getElementById('companyForexChart').getContext('2d');
  if (companyChart) companyChart.destroy();
  companyChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: {
          type: 'category',
          title: { display: true, text: 'Month' }
        },
        y: {
          title: { display: true, text: 'Rate' },
          beginAtZero: false
        }
      }
    }
  });
}

function setupUploadForm() {
  const form = document.getElementById('uploadForm');
  const input = document.getElementById('companyRatesFile');
  const button = document.getElementById('uploadButton');
  const result = document.getElementById('uploadResult');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Build FormData
    const formData = new FormData();
    for (const file of input.files) {
      formData.append('files', file);
    }

    // UI loading state
    button.disabled = true;
    button.textContent = '⏳ 上传中...';
    result.style.display = 'none';

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: formData
      });

      const text = await response.text();

      if (!response.ok) throw new Error(`上传失败: ${response.status}`);

      result.textContent = '✅ 上传成功！';
      result.style.backgroundColor = '#d4edda';
      result.style.color = '#155724';
    } catch (err) {
      console.error('Upload error:', err);
      result.textContent = '❌ 上传失败，请稍后再试';
      result.style.backgroundColor = '#f8d7da';
      result.style.color = '#721c24';
    } finally {
      result.style.display = 'block';
      button.disabled = false;
      button.textContent = '📤 上传';
    }
  });
}
