from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import re

# Helper functions
def format_time_ago(published_str, source='google'):
    """Convert datetime to Chinese relative time (几小时前/几天前)"""
    try:
        if source == 'google':
            pub_time = datetime.strptime(published_str, '%a, %d %b %Y %H:%M:%S %Z')
        else:  # investing.com
            pub_time = datetime.strptime(published_str, '%b %d, %Y')
        
        pub_time = pub_time.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = now - pub_time
        
        if delta.days > 0:
            return f"{delta.days} 天前"
        hours = int(delta.total_seconds() // 3600)
        return f"{hours} 小时前" if hours > 0 else "刚刚"
    except:
        return "时间未知"

def clean_title(title):
    """Remove date patterns from news titles"""
    return re.sub(r'\d{1,2}月\d{1,2}日', '', title).strip()

# Technical Analysis Parsers
def parse_technical_indicators(html):
    soup = BeautifulSoup(html, 'html.parser')
    indicator_names = [
        "RSI(14)", "STOCH(9,6)", "STOCHRSI(14)", "MACD(12,26)",
        "ADX(14)", "Williams %R", "CCI(14)", "ATR(14)",
        "Highs/Lows(14)", "Ultimate Oscillator", "ROC",
        "Bull/Bear Power(13)"
    ]
    
    # Find target table
    target_table = None
    for name in indicator_names:
        if indicator := soup.find('span', string=name):
            if table := indicator.find_parent('table'):
                target_table = table
                break
    
    if not target_table:
        return None
    
    # Extract indicators
    indicators = []
    for row in target_table.find_all('tr')[1:]:  # Skip header
        if cols := row.find_all('td'):
            if len(cols) >= 3 and (name := cols[0].get_text(strip=True)) in indicator_names:
                indicators.append({
                    'name': name,
                    'value': cols[1].get_text(strip=True),
                    'action': cols[2].get_text(strip=True)
                })
    
    return indicators

def parse_moving_averages(html):
    soup = BeautifulSoup(html, 'html.parser')
    ma_names = ["MA5", "MA10", "MA20", "MA50", "MA100", "MA200"]
    results = []

    for row in soup.find_all('tr'):
        if not (name_td := row.find('td', colspan="2")):
            continue
            
        if (name := name_td.get_text(strip=True)) not in ma_names:
            continue

        tds = row.find_all('td', recursive=False)
        if len(tds) < 3:
            continue

        def extract_value_action(td):
            value = td.find('div', class_='flex-1')
            action_td = td.find('td', class_=lambda c: c and 'datatable_cell--' in c)
            return (
                value.get_text(strip=True) if value else '',
                action_td.get_text(strip=True) if action_td else ''
            )

        simple_value, simple_action = extract_value_action(tds[1])
        exp_value, exp_action = extract_value_action(tds[2])

        results.append({
            'name': name,
            'simple_value': simple_value,
            'simple_action': simple_action,
            'exp_value': exp_value,
            'exp_action': exp_action,
        })

    return results

def parse_pivot_points(html):
    soup = BeautifulSoup(html, 'html.parser')
    pivot_types = ["Classic", "Fibonacci", "Camarilla", "Woodie's", "DeMark's"]
    
    if not (target_table := next(
        (pivot_span.find_parent('table') 
         for pivot_type in pivot_types 
         if (pivot_span := soup.find('span', string=pivot_type))),
        None
    )):
        return None
    
    pivot_points = []
    for row in target_table.find_all('tr')[1:]:
        if cols := row.find_all('td'):
            if len(cols) >= 8 and (name := cols[0].get_text(strip=True)) in pivot_types:
                pivot_points.append({
                    'name': name,
                    'S3': cols[1].get_text(strip=True),
                    'S2': cols[2].get_text(strip=True),
                    'S1': cols[3].get_text(strip=True),
                    'Pivot': cols[4].get_text(strip=True),
                    'R1': cols[5].get_text(strip=True),
                    'R2': cols[6].get_text(strip=True),
                    'R3': cols[7].get_text(strip=True)
                })
    
    return pivot_points

# Data Parsers
def parse_historical_data(html):
    soup = BeautifulSoup(html, 'html.parser')
    historical_data = []
    
    for row in soup.select('tbody tr'):
        if not (cells := row.find_all('td')) or len(cells) < 7:  # Ensure all columns exist
            continue
            
        try:
            if time_tag := cells[0].find('time'):
                date = datetime.strptime(
                    time_tag.get('datetime'), 
                    '%b %d, %Y'
                ).strftime('%Y-%m-%d')
                
                # Extract percentage (assuming it's in the last cell)
                change_pct_text = cells[6].get_text(strip=True)  # e.g., "+0.19%"
                change_pct = float(change_pct_text.replace('%', ''))  # → +0.19 (float)
                
                historical_data.append({
                    'date': date,
                    'close': float(cells[4].get_text(strip=True)),
                })
        except (ValueError, AttributeError) as e:
            print(f"Skipping row due to error: {e}")
            continue
    
    return historical_data

# News Parsers
def parse_investing_news(html, currency):
    """Parse Investing.com news with source appended to title"""
    soup = BeautifulSoup(html, 'html.parser')
    news_items = []
    
    for article in soup.find_all('article', {'data-test': 'article-item'}):
        try:
            title_link = article.find('a', {'data-test': 'article-title-link'})
            source = (article.find('span', {'data-test': 'news-provider-name'}) or 
                     "Investing.com").get_text(strip=True)
            
            news_items.append({
                'title': f"{title_link.get_text(strip=True)} - {source}",
                'time': format_time_ago(
                    article.find('time')['datetime'], 
                    'investing'
                ) if article.find('time') else "时间未知",
                'link': (f"https://www.investing.com{title_link['href']}" 
                        if not title_link['href'].startswith('http') 
                        else title_link['href']),
                'source': 'investing'
            })
        except Exception as e:
            print(f"Error parsing article: {e}")
            continue
    
    return news_items

def parse_google_news(feed):
    """Parse Google News RSS feed with Chinese time formatting"""
    return [{
        'title': clean_title(entry.title),
        'time': format_time_ago(entry.get("published", "")),
        'link': entry.link,
        'source': 'google'
    } for entry in feed.entries]