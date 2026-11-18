//+------------------------------------------------------------------+
//| Gold VWAP Fade · 5M  —  Strategy #2 (mean reversion)  v2.00       |
//| VWAP : anchored at broker-day open, equal-weight typical price     |
//|        (spot gold has no real volume), with σ bands               |
//| Skip : "trend days" = all 6 M5 closes 10:00–10:30 EAT on one side  |
//|        of VWAP; spread too wide; daily loss limit reached         |
//| Entry: in the EAT window, price pokes the band, then an M5 candle |
//|        closes back inside in the fade direction                   |
//| Stop : volatility based - x * ATR14(H1), or beyond the poke's     |
//|        extreme plus x * ATR14(H1) as a buffer (never < MinStopUSD) |
//| Exit : target = VWAP at entry (mean reversion) or N x the stop;   |
//|        skips trades whose target is under MinRR x the stop;       |
//|        everything flat at FlatAt EAT                              |
//| Risk : % of balance, sized from OrderCalcProfit (real contract     |
//|        size); falls back to min lot unless SkipIfMinLotTooBig     |
//| Logs every closed trade to MQL5/Files/<LogFile>; prints an R      |
//| summary; OnTester = avgR * sqrt(trades) (0 if too few trades).    |
//+------------------------------------------------------------------+
#property copyright "Gold Desk"
#property version   "2.01"   // 2.01: shared 4-trades/day cap across all Gold EAs; 2.00 tuned 2020-23, checked on 2024-Nov 2026 (out of sample). 2.00: ATR/extreme stops, VWAP or R target, auto EU DST, daily loss limit, spread filter
#include <Trade/Trade.mqh>

enum ENUM_STOPMODE { STOP_ATR = 0,       // x * ATR14(H1) from entry
                     STOP_EXTREME = 1 }; // beyond poke extreme + x * ATR14(H1)

input double InpRiskPct      = 2.0;     // Risk per trade (% of balance)
input ENUM_STOPMODE InpStopMode = STOP_EXTREME; // Stop placement
input double InpStopATR      = 1.0;     // Stop distance / buffer (x ATR14 H1)
input double InpMinStopUSD   = 1.5;     // Minimum stop distance ($)
input double InpTargetR      = 2.0;     // Target: 0 = back to VWAP, else N x stop
input double InpMinRR        = 0.8;     // Skip if target < MinRR x stop
input double InpBandK        = 2.0;     // Band width (σ)
input int    InpServerGMT    = -1;      // Broker server GMT offset (-1 = auto: 2 winter / 3 EU summer)
input int    InpWinStart     = 1000;    // Entry window start (EAT, HHMM)
input int    InpWinEnd       = 1200;    // Entry window end   (EAT, HHMM)
input int    InpFlatAt       = 1700;    // Close any open trade at (EAT, HHMM)
input int    InpMaxPerDay    = 3;       // Max trades per day
input double InpMaxDayLossR  = 2.0;     // Stop for the day after losing this many R (0 = off)
input double InpMaxSpreadUSD = 0.80;    // Skip entries when spread is wider than this ($)
input bool   InpTrendFilter  = true;    // Skip trend days
input bool   InpSkipIfMinLotTooBig = false; // Skip if min lot risks > 2x intended
input long   InpMagic        = 260118;  // Magic number (must differ from Strategy #1)
input int    InpMaxAllPerDay    = 4;            // Max NEW trades per day, all Gold EAs combined (0 = off)
input string InpCapMagics       = "260117,260118,260119"; // Magics that share the daily cap
input string InpLogFile      = "VWAPF_trades.csv"; // Trade log (MQL5/Files)

CTrade trade;
int      hATR = INVALID_HANDLE;
datetime lastBar = 0;
int      dayKey = -1, tradesToday = 0, trendSide = 0;
bool     trendChecked = false;
double   dayR = 0;               // realised R today (this EA)
int      dayRKey = -1;

//--- R bookkeeping for the summary
ulong  rPos[]; double rRisk[]; double rPnl[]; datetime rTime[];

int HHMM(const int v) { return (v / 100) * 60 + (v % 100); }

//--- EU summer time: last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC
datetime LastSunday(const int year, const int month)
{
   MqlDateTime d; ZeroMemory(d);
   d.year = (month == 12) ? year + 1 : year; d.mon = (month == 12) ? 1 : month + 1; d.day = 1;
   datetime last = StructToTime(d) - 86400;            // last day of 'month'
   MqlDateTime l; TimeToStruct(last, l);
   return last - l.day_of_week * 86400;                // back to Sunday (day_of_week 0 = Sunday)
}
bool EUSummer(const datetime utc)
{
   MqlDateTime t; TimeToStruct(utc, t);
   datetime s = LastSunday(t.year, 3) + 3600, e = LastSunday(t.year, 10) + 3600;
   return utc >= s && utc < e;
}
int ServerGMT(const datetime srv)
{
   if(InpServerGMT >= 0) return InpServerGMT;
   return EUSummer(srv - 2 * 3600) ? 3 : 2;
}
int EatMinutes(const datetime srv)
{
   MqlDateTime s; TimeToStruct(srv - ServerGMT(srv) * 3600 + 3 * 3600, s);
   return s.hour * 60 + s.min;
}

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
   if(_Period != PERIOD_M5) Print("Note: attach to an M5 chart (EA computes on M5 regardless).");
   hATR = iATR(_Symbol, PERIOD_H1, 14);
   if(hATR == INVALID_HANDLE) { Print("ATR handle error"); return INIT_FAILED; }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(50);
   return INIT_SUCCEEDED;
}

double Buf(const int h, const int shift)
{
   double b[];
   if(CopyBuffer(h, 0, shift, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}

ulong MyPosition(long &dir)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      return tk;
   }
   return 0;
}

// VWAP & σ from day open up to and including bar 'shift' (M5)
bool VwapAt(const int shift, double &vw, double &sd)
{
   datetime d0 = iTime(_Symbol, PERIOD_D1, 0);
   datetime bt = iTime(_Symbol, PERIOD_M5, shift);
   if(d0 == 0 || bt < d0) return false;
   int first = iBarShift(_Symbol, PERIOD_M5, d0, false);
   double s = 0, s2 = 0; int n = 0;
   for(int k = first; k >= shift; k--)
   {
      double tp = (iHigh(_Symbol, PERIOD_M5, k) + iLow(_Symbol, PERIOD_M5, k) + iClose(_Symbol, PERIOD_M5, k)) / 3.0;
      s += tp; s2 += tp * tp; n++;
   }
   if(n < 2) return false;
   vw = s / n; sd = MathSqrt(MathMax(s2 / n - vw * vw, 0));
   return sd > 0;
}

// Lots for 'stopDist' of price risk; riskMoney = money lost at the stop for those lots
double Lots(const double stopDist, double &riskMoney)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double target = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double perLot = 0, px = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, 1.0, px, px - stopDist, perLot)) perLot = MathAbs(perLot);
   else
   {
      double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tv <= 0) tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      perLot = stopDist / SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE) * tv;
   }
   if(perLot <= 0 || step <= 0) return 0;
   double lots = MathFloor(target / perLot / step) * step;
   if(lots < vmin)
   {
      if(InpSkipIfMinLotTooBig && vmin * perLot > 2.0 * target) { PrintFormat("VWAPF skip: min lot risks %.2f vs %.2f", vmin * perLot, target); return 0; }
      lots = vmin;
   }
   lots = MathMin(lots, vmax);
   riskMoney = lots * perLot;
   return NormalizeDouble(lots, 2);
}

void OnTick()
{
   datetime t0 = iTime(_Symbol, PERIOD_M5, 0);
   if(t0 == 0 || t0 == lastBar) return;
   lastBar = t0;

   int dk = (int)(iTime(_Symbol, PERIOD_D1, 0) / 86400);
   if(dk != dayKey) { dayKey = dk; tradesToday = 0; trendChecked = false; trendSide = 0; }
   if(dk != dayRKey) { dayRKey = dk; dayR = 0; }

   int mNow = EatMinutes(t0);
   long dir = 0; ulong tk = MyPosition(dir);

   // time stop
   if(tk != 0 && mNow >= HHMM(InpFlatAt)) { trade.PositionClose(tk); return; }

   // trend-day check once the 10:30 EAT bar has started (uses the six bars 10:00–10:30)
   if(InpTrendFilter && !trendChecked && mNow >= HHMM(InpWinStart) + 30)
   {
      int pos = 0, neg = 0;
      datetime d0 = iTime(_Symbol, PERIOD_D1, 0);
      datetime tStart = d0 + (HHMM(InpWinStart) + (ServerGMT(d0) - 3) * 60) * 60;   // window start EAT, in server time
      for(int j = 0; j < 6; j++)
      {
         int sh = iBarShift(_Symbol, PERIOD_M5, tStart + j * 300, true);
         if(sh < 1) continue;
         double v, s; if(!VwapAt(sh, v, s)) continue;
         if(iClose(_Symbol, PERIOD_M5, sh) > v) pos++; else neg++;
      }
      trendSide = (pos == 6) ? 1 : (neg == 6) ? -1 : 0;
      trendChecked = true;
   }

   double vw, sd; bool okV = VwapAt(1, vw, sd);
   double atr = Buf(hATR, 1);
   bool dayStopped = InpMaxDayLossR > 0 && dayR <= -InpMaxDayLossR;
   Comment(StringFormat("Gold VWAP Fade · 5M v2  (magic %d)\nVWAP %s  σ %.2f  bands ±%.1fσ: %s / %s   ATR(H1) %.2f\nDay: %s   trades today %d/%d   day R %.2f%s",
           InpMagic, okV ? DoubleToString(vw, _Digits) : "-", okV ? sd : 0, InpBandK,
           okV ? DoubleToString(vw + InpBandK * sd, _Digits) : "-", okV ? DoubleToString(vw - InpBandK * sd, _Digits) : "-",
           atr == EMPTY_VALUE ? 0 : atr,
           !trendChecked && InpTrendFilter ? "waiting for 10:30 check" : trendSide != 0 ? "TREND DAY - no fades" : "range day - fades allowed",
           tradesToday, InpMaxPerDay, dayR, dayStopped ? "  (daily loss limit hit)" : ""));

   if(tk != 0 || !okV || atr == EMPTY_VALUE || atr <= 0 || dayStopped) return;
   int m1 = EatMinutes(iTime(_Symbol, PERIOD_M5, 1));
   if(m1 < HHMM(InpWinStart) || m1 >= HHMM(InpWinEnd)) return;
   if(tradesToday >= InpMaxPerDay) return;
   if(InpTrendFilter && (!trendChecked || trendSide != 0)) return;

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask - bid > InpMaxSpreadUSD) return;

   double o1 = iOpen(_Symbol, PERIOD_M5, 1), c1 = iClose(_Symbol, PERIOD_M5, 1);
   double hi = MathMax(iHigh(_Symbol, PERIOD_M5, 1), iHigh(_Symbol, PERIOD_M5, 2));
   double lo = MathMin(iLow(_Symbol, PERIOD_M5, 1), iLow(_Symbol, PERIOD_M5, 2));
   double up = vw + InpBandK * sd, dn = vw - InpBandK * sd;
   int d = (hi >= up && c1 < up && c1 < o1) ? -1 : (lo <= dn && c1 > dn && c1 > o1) ? 1 : 0;
   if(d == 0) return;

   double entry = d == 1 ? ask : bid;
   double stopDist = InpStopMode == STOP_ATR ? InpStopATR * atr
                   : (d == 1 ? entry - lo : hi - entry) + InpStopATR * atr;
   stopDist = MathMax(stopDist, InpMinStopUSD);
   double tgtDist = InpTargetR > 0 ? InpTargetR * stopDist : (d == 1 ? vw - entry : entry - vw);
   if(tgtDist <= 0 || tgtDist < InpMinRR * stopDist) return;          // not enough room back to VWAP

   double riskMoney = 0, lots = Lots(stopDist, riskMoney);
   if(lots <= 0) return;
   if(!ReserveSharedSlot()) return;               // shared daily cap across all Gold EAs
   double sl = NormalizeDouble(entry - d * stopDist, _Digits), tp = NormalizeDouble(entry + d * tgtDist, _Digits);
   string cmt = "VWAPF R=" + DoubleToString(riskMoney, 2);
   bool ok = d == 1 ? trade.Buy(lots, _Symbol, 0, sl, tp, cmt) : trade.Sell(lots, _Symbol, 0, sl, tp, cmt);
   if(ok) tradesToday++;
   else PrintFormat("VWAPF order failed: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//--- log each closed trade of THIS EA to a CSV, and track today's realised R
void OnTradeTransaction(const MqlTradeTransaction &tr, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tr.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(tr.deal)) return;
   if(HistoryDealGetInteger(tr.deal, DEAL_MAGIC) != InpMagic) return;
   if(HistoryDealGetInteger(tr.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   ulong pid = (ulong)HistoryDealGetInteger(tr.deal, DEAL_POSITION_ID);
   double risk = 0; datetime tin = 0; double pin = 0; long typ = 0;
   if(HistorySelectByPosition(pid))
      for(int i = 0; i < HistoryDealsTotal(); i++)
      {
         ulong dl = HistoryDealGetTicket(i);
         if(HistoryDealGetInteger(dl, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            string c = HistoryDealGetString(dl, DEAL_COMMENT); int p = StringFind(c, "R=");
            if(p >= 0) risk = StringToDouble(StringSubstr(c, p + 2));
            tin = (datetime)HistoryDealGetInteger(dl, DEAL_TIME); pin = HistoryDealGetDouble(dl, DEAL_PRICE);
            typ = HistoryDealGetInteger(dl, DEAL_TYPE);
         }
      }
   HistoryDealSelect(tr.deal);
   double pnl = HistoryDealGetDouble(tr.deal, DEAL_PROFIT) + HistoryDealGetDouble(tr.deal, DEAL_COMMISSION) + HistoryDealGetDouble(tr.deal, DEAL_SWAP);
   if(risk > 0) dayR += pnl / risk;
   long reason = HistoryDealGetInteger(tr.deal, DEAL_REASON);
   string why = reason == DEAL_REASON_SL ? "SL" : reason == DEAL_REASON_TP ? "TP" : "time/manual";
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION)) return;   // no CSV during tests
   bool newFile = !FileIsExist(InpLogFile);
   int fh = FileOpen(InpLogFile, FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(fh == INVALID_HANDLE) return;
   FileSeek(fh, 0, SEEK_END);
   if(newFile) FileWrite(fh, "strategy", "position", "entry_time", "dir", "entry", "exit_time", "exit", "exit_reason", "lots", "pnl", "risk_money", "R");
   FileWrite(fh, "VWAP Fade 5M v2", (long)pid, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", DoubleToString(pin, _Digits),
             TimeToString((datetime)HistoryDealGetInteger(tr.deal, DEAL_TIME)), DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_PRICE), _Digits),
             why, DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_VOLUME), 2), DoubleToString(pnl, 2), DoubleToString(risk, 2),
             risk > 0 ? DoubleToString(pnl / risk, 2) : "");
   FileClose(fh);
}

//--- R-multiple summary from deal history
double BuildRStats(string &report, int &trades)
{
   ArrayResize(rPos, 0); ArrayResize(rRisk, 0); ArrayResize(rPnl, 0); ArrayResize(rTime, 0);
   HistorySelect(0, TimeCurrent() + 86400);
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong dl = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(dl, DEAL_MAGIC) != InpMagic) continue;
      if(HistoryDealGetString(dl, DEAL_SYMBOL) != _Symbol) continue;
      ulong pid = (ulong)HistoryDealGetInteger(dl, DEAL_POSITION_ID);
      int k = -1;
      for(int j = 0; j < ArraySize(rPos); j++) if(rPos[j] == pid) { k = j; break; }
      if(k < 0)
      {
         k = ArraySize(rPos);
         ArrayResize(rPos, k + 1); ArrayResize(rRisk, k + 1); ArrayResize(rPnl, k + 1); ArrayResize(rTime, k + 1);
         rPos[k] = pid; rRisk[k] = 0; rPnl[k] = 0; rTime[k] = (datetime)HistoryDealGetInteger(dl, DEAL_TIME);
      }
      if(HistoryDealGetInteger(dl, DEAL_ENTRY) == DEAL_ENTRY_IN)
      {
         string c = HistoryDealGetString(dl, DEAL_COMMENT); int p = StringFind(c, "R=");
         if(p >= 0) rRisk[k] = StringToDouble(StringSubstr(c, p + 2));
      }
      rPnl[k] += HistoryDealGetDouble(dl, DEAL_PROFIT) + HistoryDealGetDouble(dl, DEAL_COMMISSION) + HistoryDealGetDouble(dl, DEAL_SWAP);
   }
   int n = 0, w = 0, streak = 0, maxStreak = 0;
   double sum = 0, gw = 0, gl = 0, cum = 0, peak = 0, mdd = 0;
   for(int k = 0; k < ArraySize(rPos); k++)
   {
      if(rRisk[k] <= 0) continue;
      double r = rPnl[k] / rRisk[k];
      n++; sum += r; cum += r; peak = MathMax(peak, cum); mdd = MathMax(mdd, peak - cum);
      if(r > 0) { w++; gw += r; streak = 0; } else { gl -= r; streak++; maxStreak = MathMax(maxStreak, streak); }
   }
   trades = n;
   report = StringFormat("VWAPF R-summary: trades=%d  win=%.1f%%  netR=%.1f  avgR=%.3f  PF=%.2f  maxDD=%.1fR  longest losing run=%d",
            n, n ? 100.0 * w / n : 0, sum, n ? sum / n : 0, gl > 0 ? gw / gl : 0, mdd, maxStreak);
   return n ? sum / n : 0;
}

double OnTester()
{
   string rep; int n = 0; double avg = BuildRStats(rep, n);
   Print(rep);
   if(n < 40) return 0;                          // too few trades to trust
   return avg * MathSqrt(n);                     // rewards a consistent edge, not one lucky run
}

void OnDeinit(const int reason)
{
   Comment("");
   if(!MQLInfoInteger(MQL_TESTER)) { string rep; int n; BuildRStats(rep, n); Print(rep); }
}
//+------------------------------------------------------------------+
