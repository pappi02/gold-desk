//+------------------------------------------------------------------+
//| Gold Strategy C  —  HTF bias · Prev-day OR Asian break · ATR trail|
//| Bias   : Daily AND H4 agree (close vs EMA50, EMA20 vs EMA50)      |
//| Entry  : closed M15 candle makes a FRESH close through            |
//|          (a) previous-day high/low, or (b) Asian range high/low   |
//|          (Asian range 03:00-10:00 EAT, used from 10:00 EAT)       |
//|          Windows: London 10:00-14:00 / NY 15:30-20:00 EAT         |
//| Limits : max N new trades per broker day (default 3); positions   |
//|          may overlap; optional cap on open positions              |
//| Stop   : 0.75 x ATR14(H4, Wilder)                                 |
//| Exit   : no TP. After +1R, trailing stop = best price - 3 x ATR.  |
//|          Optional: stop to entry once +InpBreakevenR (0 = off).   |
//|          Optional: once +InpSwingLockR, stop just beyond the      |
//|          latest swing high/low that is in profit (else entry);    |
//|          can keep following newer swings (InpSwingTrail).         |
//|          Time stop 10 days.                                       |
//| Attach to an XAUUSD (or XAUUSDc) M15 chart. Works on cent accts.  |
//| Each closed trade is logged to MQL5/Files/<InpLogFile>.           |
//+------------------------------------------------------------------+
#property copyright "Gold Desk"
#property version   "1.04"   // 1.04: optional swing-structure profit lock (InpSwingLockR, off by default); 1.03: optional breakeven stop (InpBreakevenR, off by default); 1.02: shared 4-trades/day cap across all Gold EAs; 1.01: lot size from OrderCalcProfit (tick value bug)
#include <Trade/Trade.mqh>

input double InpRiskPct        = 2.0;    // Risk per trade (% of balance)
input double InpStopATR        = 0.75;   // Initial stop (x H4 ATR14)
input double InpTrailATR       = 3.0;    // Trailing distance (x H4 ATR14)
input double InpTrailStartR    = 1.0;    // Start trailing after +R
input double InpBreakevenR     = 0.0;    // Move stop to entry after +R (0 = off)
input double InpSwingLockR     = 0.0;    // Lock profit at the latest swing after +R (0 = off)
input ENUM_TIMEFRAMES InpSwingTF = PERIOD_H1; // Swing timeframe
input int    InpSwingBars      = 2;      // Swing = bar beyond N bars each side
input double InpSwingBufATR    = 0.1;    // Stop buffer beyond the swing (x H4 ATR)
input bool   InpSwingTrail     = true;   // Keep moving the stop to newer swings
input int    InpSwingLookback  = 100;    // Bars searched for the latest swing
input int    InpMaxDays        = 10;     // Time stop (days)
input int    InpMaxTradesPerDay= 3;      // Max NEW trades per broker day
input int    InpMaxOpen        = 0;      // Max open positions (0 = no cap)
input bool   InpUsePrevDay     = true;   // Trigger: previous-day high/low break
input bool   InpUseAsian       = true;   // Trigger: Asian range high/low break
input int    InpServerGMT      = 2;      // Broker server time = GMT + ? (3 in EU summer)
input int    InpAsiaStart      = 300;    // Asian range start (EAT, HHMM)
input int    InpAsiaEnd        = 1000;   // Asian range end   (EAT, HHMM)
input int    InpLonStart       = 1000;   // London window start (EAT, HHMM)
input int    InpLonEnd         = 1400;   // London window end   (EAT, HHMM)
input int    InpNYStart        = 1530;   // NY window start     (EAT, HHMM)
input int    InpNYEnd          = 2000;   // NY window end       (EAT, HHMM)
input bool   InpSkipIfMinLotTooBig = false;// Skip if min lot risks > 2x intended
input long   InpMagic          = 260119; // Magic number (must differ from other EAs)
input int    InpMaxAllPerDay    = 4;            // Max NEW trades per day, all Gold EAs combined (0 = off)
input string InpCapMagics       = "260117,260118,260119"; // Magics that share the daily cap
input string InpLogFile        = "StratC_trades.csv"; // Trade log (MQL5/Files)

CTrade trade;
int hD20, hD50, hH20, hH50;
datetime lastM15 = 0, lastM1 = 0;
ulong  cTk[]; double cBest[];          // cached best price per position

int    HHMM(const int v) { return (v / 100) * 60 + (v % 100); }
int    EatMin(const datetime srv) { MqlDateTime s; TimeToStruct(srv - InpServerGMT*3600 + 3*3600, s); return s.hour*60 + s.min; }
double Buf(const int h, const int sh) { double b[]; if(CopyBuffer(h, 0, sh, 1, b) != 1) return EMPTY_VALUE; return b[0]; }

//--- Shared daily cap across all Gold EAs (same account + symbol). Counts today's entry
//--- deals of every magic in InpCapMagics, and reserves a slot through a terminal global
//--- variable so two EAs firing on the same tick cannot both take the last slot.
int CountCapEntriesToday()
{
   string parts[]; int np = StringSplit(InpCapMagics, ',', parts);
   datetime d0 = iTime(_Symbol, PERIOD_D1, 0);
   if(d0 == 0 || !HistorySelect(d0, TimeCurrent() + 60)) return 0;
   int c = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong dl = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(dl, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      if(HistoryDealGetString(dl, DEAL_SYMBOL) != _Symbol) continue;
      long mg = HistoryDealGetInteger(dl, DEAL_MAGIC);
      for(int j = 0; j < np; j++) if(StringToInteger(parts[j]) == mg) { c++; break; }
   }
   return c;
}
bool ReserveSharedSlot()
{
   if(InpMaxAllPerDay <= 0) return true;
   string key = "GoldCap_" + _Symbol + "_" + IntegerToString((long)(iTime(_Symbol, PERIOD_D1, 0) / 86400));
   if(!GlobalVariableCheck(key)) GlobalVariableSet(key, 0);
   for(int attempt = 0; attempt < 20; attempt++)
   {
      double v = GlobalVariableGet(key);
      int used = (int)MathMax(v, CountCapEntriesToday());
      if(used >= InpMaxAllPerDay) { PrintFormat("Shared cap: %d of %d trades already taken today - no entry", used, InpMaxAllPerDay); return false; }
      if(GlobalVariableSetOnCondition(key, used + 1, v)) return true;
      Sleep(50);
   }
   return false;
}

int OnInit()
{
   hD20 = iMA(_Symbol, PERIOD_D1, 20, 0, MODE_EMA, PRICE_CLOSE);
   hD50 = iMA(_Symbol, PERIOD_D1, 50, 0, MODE_EMA, PRICE_CLOSE);
   hH20 = iMA(_Symbol, PERIOD_H4, 20, 0, MODE_EMA, PRICE_CLOSE);
   hH50 = iMA(_Symbol, PERIOD_H4, 50, 0, MODE_EMA, PRICE_CLOSE);
   if(hD20 == INVALID_HANDLE || hD50 == INVALID_HANDLE || hH20 == INVALID_HANDLE || hH50 == INVALID_HANDLE)
   { Print("Indicator handle error"); return INIT_FAILED; }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(50);
   return INIT_SUCCEEDED;
}

// Wilder ATR14 on completed H4 bars (shift 1)
double AtrH4()
{
   MqlRates r[]; ArraySetAsSeries(r, false);
   int n = CopyRates(_Symbol, PERIOD_H4, 1, 300, r);
   if(n < 30) return EMPTY_VALUE;
   double atr = r[1].high - r[1].low;
   for(int i = 1; i < n; i++)
   {
      double tr = MathMax(r[i].high - r[i].low, MathMax(MathAbs(r[i].high - r[i-1].close), MathAbs(r[i].low - r[i-1].close)));
      atr = (i == 1) ? tr : atr + (tr - atr) / 14.0;
   }
   return atr;
}

int CountOpen()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i); if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagic) c++;
   }
   return c;
}

int TradesToday()
{
   datetime d0 = iTime(_Symbol, PERIOD_D1, 0);
   if(!HistorySelect(d0, TimeCurrent() + 60)) return 0;
   int c = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong dl = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(dl, DEAL_MAGIC) != InpMagic || HistoryDealGetString(dl, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(dl, DEAL_ENTRY) == DEAL_ENTRY_IN) c++;
   }
   return c;
}

bool AsianRange(const datetime barTime, double &ah, double &al)
{
   datetime eat = barTime - InpServerGMT*3600 + 3*3600;
   datetime eatMidnight = eat - (eat % 86400);
   datetime srvMidnight = eatMidnight + (InpServerGMT - 3) * 3600;   // 00:00 EAT in server time
   datetime t0 = srvMidnight + HHMM(InpAsiaStart) * 60, t1 = srvMidnight + HHMM(InpAsiaEnd) * 60;
   if(barTime < t1) return false;                                     // range not locked yet
   double hi[], lo[];
   int nh = CopyHigh(_Symbol, PERIOD_M15, t0, t1 - 1, hi), nl = CopyLow(_Symbol, PERIOD_M15, t0, t1 - 1, lo);
   if(nh < 16 || nl < 16) return false;
   ah = hi[ArrayMaximum(hi)]; al = lo[ArrayMinimum(lo)];
   return true;
}

double Lots(const double riskPts, double &riskMoney, const int dir)
{
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double target = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   // Money lost per 1.0 lot at the stop. OrderCalcProfit uses the real contract size;
   // some servers (MetaQuotes-Demo XAUUSD) report a tick value 10x too small.
   double perLot = 0, px0 = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, 1.0, px0, px0 - riskPts, perLot)) perLot = MathAbs(perLot);
   else perLot = riskPts / ts * tv;
   if(perLot <= 0) return 0;
   double lots = MathFloor(target / perLot / step) * step;
   if(lots < vmin)
   {
      if(InpSkipIfMinLotTooBig && vmin * perLot > 2.0 * target) { PrintFormat("StratC skip: min lot risks %.2f vs %.2f", vmin*perLot, target); return 0; }
      lots = vmin;
   }
   lots = MathMin(lots, vmax);
   double price = dir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID), margin = 0;
   if(OrderCalcMargin(dir == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lots, price, margin) &&
      margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9)
   { Print("StratC skip: not enough free margin"); return 0; }
   riskMoney = lots * perLot;
   return NormalizeDouble(lots, 2);
}

double ParseTag(const string c, const string key)
{
   int p = StringFind(c, key); if(p < 0) return 0;
   int e = StringFind(c, " ", p); string v = e < 0 ? StringSubstr(c, p + StringLen(key)) : StringSubstr(c, p + StringLen(key), e - p - StringLen(key));
   return StringToDouble(v);
}

double CachedBest(const ulong tk, const int dir, const datetime openT, const double openP, const bool refresh)
{
   int k = -1; bool doRefresh = refresh;
   for(int i = 0; i < ArraySize(cTk); i++) if(cTk[i] == tk) { k = i; break; }
   if(k < 0) { k = ArraySize(cTk); ArrayResize(cTk, k + 1); ArrayResize(cBest, k + 1); cTk[k] = tk; cBest[k] = openP; doRefresh = true; }
   if(doRefresh)
   {
      double a[]; double sp = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(dir == 1) { if(CopyHigh(_Symbol, PERIOD_M1, openT, TimeCurrent(), a) > 0) cBest[k] = MathMax(cBest[k], a[ArrayMaximum(a)]); }
      else         { if(CopyLow (_Symbol, PERIOD_M1, openT, TimeCurrent(), a) > 0) cBest[k] = MathMin(cBest[k], a[ArrayMinimum(a)] + sp); }
   }
   double now = dir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   cBest[k] = dir == 1 ? MathMax(cBest[k], now) : MathMin(cBest[k], now);
   return cBest[k];
}

// Stop just beyond the most recent confirmed swing on InpSwingTF that locks profit
// (sell: swing high below entry; buy: swing low above entry) and is a valid stop now.
// Returns 0 if the latest usable swing does not lock profit.
double SwingStop(const int dir, const double op, const double atr)
{
   double sp  = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double gap = MathMax((double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL), 10.0) * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double px  = dir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double buf = InpSwingBufATR * atr;
   int n = MathMax(InpSwingBars, 1);
   for(int b = n + 1; b <= n + InpSwingLookback; b++)
   {
      if(dir == -1)
      {
         double h = iHigh(_Symbol, InpSwingTF, b); if(h <= 0) break;
         bool sw = true;
         for(int j = 1; j <= n && sw; j++) if(iHigh(_Symbol, InpSwingTF, b - j) >= h || iHigh(_Symbol, InpSwingTF, b + j) > h) sw = false;
         if(!sw) continue;
         double c = h + sp + buf;
         if(c <= px + gap) continue;                      // too close to price: use the next older swing
         return c < op ? NormalizeDouble(c, _Digits) : 0;
      }
      else
      {
         double l = iLow(_Symbol, InpSwingTF, b); if(l <= 0) break;
         bool sw = true;
         for(int j = 1; j <= n && sw; j++) if(iLow(_Symbol, InpSwingTF, b - j) <= l || iLow(_Symbol, InpSwingTF, b + j) < l) sw = false;
         if(!sw) continue;
         double c = l - buf;
         if(c >= px - gap) continue;
         return c > op ? NormalizeDouble(c, _Digits) : 0;
      }
   }
   return 0;
}

void ManagePositions()
{
   datetime m1 = iTime(_Symbol, PERIOD_M1, 0); bool refresh = (m1 != lastM1); lastM1 = m1;
   double pt = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i); if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      int dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      datetime ot = (datetime)PositionGetInteger(POSITION_TIME);
      double op = PositionGetDouble(POSITION_PRICE_OPEN), sl = PositionGetDouble(POSITION_SL);
      if(TimeCurrent() - ot >= InpMaxDays * 86400) { trade.PositionClose(tk); continue; }
      double atr = ParseTag(PositionGetString(POSITION_COMMENT), "A=");
      if(atr <= 0) atr = AtrH4();
      if(atr == EMPTY_VALUE || atr <= 0) continue;
      double r = InpStopATR * atr;
      double best = CachedBest(tk, dir, ot, op, refresh);
      double ns = 0;                                            // candidate stop (0 = none yet)
      if((best - op) * dir >= InpTrailStartR * r) ns = NormalizeDouble(best - dir * InpTrailATR * atr, _Digits);
      if(InpBreakevenR > 0 && (best - op) * dir >= InpBreakevenR * r)
      {
         double be = NormalizeDouble(op, _Digits);            // the tighter of breakeven and the trail
         ns = ns == 0 ? be : dir == 1 ? MathMax(ns, be) : MathMin(ns, be);
      }
      if(InpSwingLockR > 0 && refresh && (best - op) * dir >= InpSwingLockR * r)   // once a minute is enough
      {
         bool locked = sl != 0 && (sl - op) * dir > 0;       // stop already in profit
         if(InpSwingTrail || !locked)
         {
            double sw = SwingStop(dir, op, atr);
            if(sw == 0 && !locked) sw = NormalizeDouble(op, _Digits);   // no swing in profit yet: at least breakeven
            if(sw != 0) ns = ns == 0 ? sw : dir == 1 ? MathMax(ns, sw) : MathMin(ns, sw);
         }
      }
      if(ns == 0) continue;
      if((dir == 1 && ns > sl + 10*pt) || (dir == -1 && (sl == 0 || ns < sl - 10*pt)))
         trade.PositionModify(tk, ns, 0);
   }
}

void OnTick()
{
   ManagePositions();

   datetime t0 = iTime(_Symbol, PERIOD_M15, 0);
   if(t0 == 0 || t0 == lastM15) return;
   lastM15 = t0;

   double dC = iClose(_Symbol, PERIOD_D1, 1), dE20 = Buf(hD20, 1), dE50 = Buf(hD50, 1);
   double hC = iClose(_Symbol, PERIOD_H4, 1), hE20 = Buf(hH20, 1), hE50 = Buf(hH50, 1);
   if(dE50 == EMPTY_VALUE || hE50 == EMPTY_VALUE) return;
   int dT = (dC > dE50 && dE20 > dE50) ? 1 : (dC < dE50 && dE20 < dE50) ? -1 : 0;
   int hT = (hC > hE50 && hE20 > hE50) ? 1 : (hC < hE50 && hE20 < hE50) ? -1 : 0;
   int bias = (dT == hT) ? dT : 0;
   double pdh = iHigh(_Symbol, PERIOD_D1, 1), pdl = iLow(_Symbol, PERIOD_D1, 1);
   datetime b1 = iTime(_Symbol, PERIOD_M15, 1);
   double ah = 0, al = 0; bool hasAsia = AsianRange(b1, ah, al);
   int today = TradesToday(), openN = CountOpen();

   Comment(StringFormat("Gold Strategy C (magic %d)\nBias (D+H4): %s\nPrev day H/L: %s / %s\nAsian H/L: %s\nTrades today %d/%d   open %d%s",
           InpMagic, bias == 1 ? "LONG only" : bias == -1 ? "SHORT only" : "NO TRADE",
           DoubleToString(pdh, _Digits), DoubleToString(pdl, _Digits),
           hasAsia ? DoubleToString(ah, _Digits) + " / " + DoubleToString(al, _Digits) : "forming (locks 10:00 EAT)",
           today, InpMaxTradesPerDay, openN, InpMaxOpen > 0 ? StringFormat("/%d", InpMaxOpen) : ""));

   if(bias == 0 || today >= InpMaxTradesPerDay || (InpMaxOpen > 0 && openN >= InpMaxOpen)) return;
   int m = EatMin(b1);
   bool inWin = (m >= HHMM(InpLonStart) && m < HHMM(InpLonEnd)) || (m >= HHMM(InpNYStart) && m < HHMM(InpNYEnd));
   if(!inWin) return;

   double c1 = iClose(_Symbol, PERIOD_M15, 1), c2 = iClose(_Symbol, PERIOD_M15, 2);
   string trig = "";
   if(InpUsePrevDay && ((bias == 1 && c1 > pdh && c2 <= pdh) || (bias == -1 && c1 < pdl && c2 >= pdl))) trig = "PD";
   else if(InpUseAsian && hasAsia && ((bias == 1 && c1 > ah && c2 <= ah) || (bias == -1 && c1 < al && c2 >= al))) trig = "AS";
   if(trig == "") return;

   double atr = AtrH4(); if(atr == EMPTY_VALUE || atr <= 0) return;
   double riskPts = InpStopATR * atr, riskMoney = 0;
   double lots = Lots(riskPts, riskMoney, bias);
   if(lots <= 0) return;
   if(!ReserveSharedSlot()) return;               // shared daily cap across all Gold EAs
   string cmt = "C " + trig + " R=" + DoubleToString(riskMoney, 2) + " A=" + DoubleToString(atr, 2);
   bool ok;
   if(bias == 1) { double a = SymbolInfoDouble(_Symbol, SYMBOL_ASK); ok = trade.Buy(lots, _Symbol, 0, NormalizeDouble(a - riskPts, _Digits), 0, cmt); }
   else          { double b = SymbolInfoDouble(_Symbol, SYMBOL_BID); ok = trade.Sell(lots, _Symbol, 0, NormalizeDouble(b + riskPts, _Digits), 0, cmt); }
   if(!ok) PrintFormat("StratC order failed: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//--- per-trade CSV log (trigger, R) for separate tracking
void OnTradeTransaction(const MqlTradeTransaction &tr, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tr.type != TRADE_TRANSACTION_DEAL_ADD || !HistoryDealSelect(tr.deal)) return;
   if(HistoryDealGetInteger(tr.deal, DEAL_MAGIC) != InpMagic || HistoryDealGetInteger(tr.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   ulong pid = (ulong)HistoryDealGetInteger(tr.deal, DEAL_POSITION_ID);
   double risk = 0, pin = 0; datetime tin = 0; long typ = 0; string trg = "";
   if(HistorySelectByPosition(pid))
      for(int i = 0; i < HistoryDealsTotal(); i++)
      {
         ulong dl = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(dl, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
         string c = HistoryDealGetString(dl, DEAL_COMMENT);
         risk = ParseTag(c, "R="); trg = StringFind(c, " PD") >= 0 ? "Prev-day break" : StringFind(c, " AS") >= 0 ? "Asian break" : "?";
         tin = (datetime)HistoryDealGetInteger(dl, DEAL_TIME); pin = HistoryDealGetDouble(dl, DEAL_PRICE); typ = HistoryDealGetInteger(dl, DEAL_TYPE);
      }
   HistoryDealSelect(tr.deal);
   double pnl = HistoryDealGetDouble(tr.deal, DEAL_PROFIT) + HistoryDealGetDouble(tr.deal, DEAL_COMMISSION) + HistoryDealGetDouble(tr.deal, DEAL_SWAP);
   long reason = HistoryDealGetInteger(tr.deal, DEAL_REASON);
   string why = reason == DEAL_REASON_SL ? "Stop/Trail" : reason == DEAL_REASON_TP ? "TP" : "Time/manual";
   if(MQLInfoInteger(MQL_TESTER))                     // tester: one journal line per closed trade, for reports
      PrintFormat("CTRADE|%s|%s|%s|%.2f|%.2f|%s|%.2f", trg, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", pnl, risk, why, HistoryDealGetDouble(tr.deal, DEAL_VOLUME));
   bool newFile = !FileIsExist(InpLogFile);
   int fh = FileOpen(InpLogFile, FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(fh == INVALID_HANDLE) return;
   FileSeek(fh, 0, SEEK_END);
   if(newFile) FileWrite(fh, "strategy", "trigger", "position", "entry_time", "dir", "entry", "exit_time", "exit", "exit_reason", "lots", "pnl", "risk_money", "R");
   FileWrite(fh, "Strategy C", trg, (long)pid, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", DoubleToString(pin, _Digits),
             TimeToString((datetime)HistoryDealGetInteger(tr.deal, DEAL_TIME)), DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_PRICE), _Digits),
             why, DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_VOLUME), 2), DoubleToString(pnl, 2), DoubleToString(risk, 2),
             risk > 0 ? DoubleToString(pnl / risk, 2) : "");
   FileClose(fh);
}

//--- R summary in tester (Journal) + custom criterion = avg R
double OnTester()
{
   HistorySelect(0, TimeCurrent() + 86400);
   ulong pos[]; double rk[], pl[]; string tg[]; int n = 0;
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong dl = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(dl, DEAL_MAGIC) != InpMagic) continue;
      ulong pid = (ulong)HistoryDealGetInteger(dl, DEAL_POSITION_ID); int k = -1;
      for(int j = 0; j < n; j++) if(pos[j] == pid) { k = j; break; }
      if(k < 0) { k = n++; ArrayResize(pos, n); ArrayResize(rk, n); ArrayResize(pl, n); ArrayResize(tg, n); pos[k] = pid; rk[k] = 0; pl[k] = 0; tg[k] = ""; }
      if(HistoryDealGetInteger(dl, DEAL_ENTRY) == DEAL_ENTRY_IN)
      { string c = HistoryDealGetString(dl, DEAL_COMMENT); rk[k] = ParseTag(c, "R="); tg[k] = StringFind(c, " PD") >= 0 ? "PD" : "AS"; }
      pl[k] += HistoryDealGetDouble(dl, DEAL_PROFIT) + HistoryDealGetDouble(dl, DEAL_COMMISSION) + HistoryDealGetDouble(dl, DEAL_SWAP);
   }
   double sAll = 0, sPD = 0, sAS = 0; int nAll = 0, nPD = 0, nAS = 0, wAll = 0;
   for(int k = 0; k < n; k++)
   {
      if(rk[k] <= 0) continue; double r = pl[k] / rk[k];
      sAll += r; nAll++; if(r > 0) wAll++;
      if(tg[k] == "PD") { sPD += r; nPD++; } else { sAS += r; nAS++; }
   }
   PrintFormat("StratC R-summary: trades=%d win=%.1f%% avgR=%.3f netR=%.1f | Prev-day: %d trades avgR=%.3f | Asian: %d trades avgR=%.3f",
               nAll, nAll ? 100.0*wAll/nAll : 0, nAll ? sAll/nAll : 0, sAll, nPD, nPD ? sPD/nPD : 0, nAS, nAS ? sAS/nAS : 0);
   return nAll ? sAll / nAll : 0;
}

void OnDeinit(const int reason) { Comment(""); }
//+------------------------------------------------------------------+
