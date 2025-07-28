// parse.js

const data = require('./data/company_data.json');

// pull out all booking currencies
const currencies = [
  ...new Set(
    data
      .filter(m => m.kind === 'booking' && Array.isArray(m.rates))
      .flatMap(m => m.rates.map(r => r.currency))
  )
];

currencies.forEach(currency => {
  // flatMap each month, but skip any m where rates is missing
  const series = data.flatMap(m => {
    if (!Array.isArray(m.rates)) return [];   // <-- skip
    const rate = m.rates.find(r => r.currency === currency);
    if (!rate) return [];

    const points = [];
    if (m.kind === 'booking') {
      if (rate.ntd     != null) points.push({ series:`${currency} NTD`,     month:m.yearMonth, value:rate.ntd     });
      if (rate.usd     != null) points.push({ series:`${currency} USD`,     month:m.yearMonth, value:rate.usd     });
    }
    if (m.kind === 'ending') {
      if (rate.monthly != null) points.push({ series:`${currency} Monthly`, month:m.yearMonth, value:rate.monthly });
      if (rate.ytd     != null) points.push({ series:`${currency} YTD`,     month:m.yearMonth, value:rate.ytd     });
    }
    return points;
  });

  console.log(`\n=== ${currency} ===`);
  console.log(series);
});
