//+------------------------------------------------------------------+
//| Gold HTF Bias · 15M Entry  —  Expert Advisor (MT5)                |
//| Bias  : Daily AND H4 agree (close vs EMA50, EMA20 vs EMA50)       |
//| Entry : London / NY window (EAT), 15M close through prev-day H/L  |
//|         max 1 trade per day                                       |
//| Stop  : InpStopATR x ATR14(H4)                                    |
//| Exit  : first H4 candle opened after entry that CLOSES back       |
//|         across H4 EMA20; time stop InpMaxDays. No fixed target.   |
//| Attach to an M15 chart of your gold symbol.                       |
//+------------------------------------------------------------------+
#property copyright "Gold Desk"
#property version   "1.12"   // 1.12: shared 4-trades/day cap across all Gold EAs; 1.11: lot size from OrderCalcProfit (tick value bug); 1.10: close by ticket, CSV trade log
#include <Trade/Trade.mqh>

enum ENUM_RUNMODE { RUN_AUTO = 0,     // Auto-trade
                    RUN_SIGNALS = 1 }; // Signals / alerts only
enum ENUM_TRIGGER { TRIG_PDBREAK = 0,  // Prev-day high/low break
                    TRIG_PULLBACK = 1 }; // 15M EMA20 pullback

input ENUM_RUNMODE InpMode      = RUN_AUTO;     // Mode
input ENUM_TRIGGER InpTrigger   = TRIG_PDBREAK; // Entry trigger
input double InpRiskPct         = 2.0;          // Risk per trade (% of balance)
input double InpStopATR         = 1.0;          // Stop distance (x H4 ATR14)
input int    InpMaxDays         = 10;           // Time stop (days)
input int    InpServerGMT       = 2;            // Broker server time = GMT + ? (check Market Watch clock)
input int    InpLonStart        = 1000;         // London window start (EAT, HHMM)
input int    InpLonEnd          = 1400;         // London window end   (EAT, HHMM)
input int    InpNYStart         = 1530;         // NY window start     (EAT, HHMM)
input int    InpNYEnd           = 2000;         // NY window end       (EAT, HHMM)
input bool   InpSkipIfMinLotTooBig = false;     // Skip trade if min lot risks > 2x intended
input long   InpMagic           = 260117;       // Magic number
input int    InpMaxAllPerDay    = 4;            // Max NEW trades per day, all Gold EAs combined (0 = off)
input string InpCapMagics       = "260117,260118,260119"; // Magics that share the daily cap
input string InpLogFile         = "HTF15_trades.csv"; // Trade log (MQL5/Files)

CTrade trade;
int hD20, hD50, hH20, hH50, hATR, hM20;
datetime lastM15 = 0;
int lastTradeDay = -1;

//--- R bookkeeping (for the summary at the end of a backtest)
ulong  rPos[]; double rRisk[]; double rPnl[]; datetime rTime[];

double Buf(const int h, const int shift)
{
   double b[];
   if(CopyBuffer(h, 0, shift, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}
int HHMMtoMin(const int v) { return (v / 100) * 60 + (v % 100); }

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
   hATR = iATR(_Symbol, PERIOD_H4, 14);
   hM20 = iMA(_Symbol, PERIOD_M15, 20, 0, MODE_EMA, PRICE_CLOSE);
   if(hD20 == INVALID_HANDLE || hD50 == INVALID_HANDLE || hH20 == INVALID_HANDLE ||
      hH50 == INVALID_HANDLE || hATR == INVALID_HANDLE || hM20 == INVALID_HANDLE)
   { Print("Indicator handle error"); return INIT_FAILED; }
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(50);
   return INIT_SUCCEEDED;
}

ulong posTicket = 0;
bool GetPosition(long &dir, datetime &openTime)
{
   posTicket = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      openTime = (datetime)PositionGetInteger(POSITION_TIME);
      posTicket = tk;
      return true;
   }
   return false;
}

double LotsForRisk(const double riskPts, double &riskMoney)
{
   double tickVal  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickVal <= 0) tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double step     = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin     = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax     = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double target   = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   // Money lost per 1.0 lot at the stop. OrderCalcProfit uses the real contract size;
   // some servers (MetaQuotes-Demo XAUUSD) report a tick value 10x too small.
   double perLot = 0, px = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, 1.0, px, px - riskPts, perLot)) perLot = MathAbs(perLot);
   else perLot = riskPts / tickSize * tickVal;
   if(perLot <= 0) return 0;
   double lots = MathFloor(target / perLot / step) * step;
   if(lots < vmin)
   {
      if(InpSkipIfMinLotTooBig && vmin * perLot > 2.0 * target)
      { PrintFormat("Skip: min lot %.2f would risk %.2f vs target %.2f", vmin, vmin * perLot, target); return 0; }
      lots = vmin;
   }
   lots = MathMin(lots, vmax);
   riskMoney = lots * perLot;
   return NormalizeDouble(lots, 2);
}

void Mark(const string txt, const datetime t, const double price, const color c, const int code)
{
   string nm = "HTF15_" + IntegerToString((long)t);
   ObjectCreate(0, nm, OBJ_ARROW, 0, t, price);
   ObjectSetInteger(0, nm, OBJPROP_ARROWCODE, code);
   ObjectSetInteger(0, nm, OBJPROP_COLOR, c);
   ObjectSetString(0, nm, OBJPROP_TOOLTIP, txt);
}

void OnTick()
{
   datetime t0 = iTime(_Symbol, PERIOD_M15, 0);
   if(t0 == 0 || t0 == lastM15) return;             // work once per new 15M bar
   lastM15 = t0;

   //--- higher timeframe values from COMPLETED bars (shift 1)
   double dC = iClose(_Symbol, PERIOD_D1, 1), dE20 = Buf(hD20, 1), dE50 = Buf(hD50, 1);
   double hC = iClose(_Symbol, PERIOD_H4, 1), hE20 = Buf(hH20, 1), hE50 = Buf(hH50, 1), hAtr = Buf(hATR, 1);
   double pdh = iHigh(_Symbol, PERIOD_D1, 1), pdl = iLow(_Symbol, PERIOD_D1, 1);
   if(dE50 == EMPTY_VALUE || hE50 == EMPTY_VALUE || hAtr == EMPTY_VALUE) return;

   int dT = (dC > dE50 && dE20 > dE50) ? 1 : (dC < dE50 && dE20 < dE50) ? -1 : 0;
   int hT = (hC > hE50 && hE20 > hE50) ? 1 : (hC < hE50 && hE20 < hE50) ? -1 : 0;
   int bias = (dT == hT) ? dT : 0;

   long dir; datetime openT;
   bool inPos = GetPosition(dir, openT);

   //--- exits (auto mode)
   if(inPos)
   {
      datetime h4Open1 = iTime(_Symbol, PERIOD_H4, 1);
      bool emaExit  = (h4Open1 >= openT) && ((hC - hE20) * dir < 0);
      bool timeExit = (t0 - openT) >= InpMaxDays * 86400;
      if(emaExit || timeExit)
      {
         if(InpMode == RUN_AUTO) trade.PositionClose(posTicket);
         if(InpMode == RUN_SIGNALS || !MQLInfoInteger(MQL_TESTER))
            Alert(_Symbol, emaExit ? ": EXIT — H4 closed back across EMA20" : ": EXIT — time stop");
      }
   }

   //--- comment panel
   Comment(StringFormat("Gold HTF Bias · 15M\nBias (D+H4): %s\nPrev day H/L: %s / %s\nH4 EMA20: %s   H4 ATR: %.2f",
           bias == 1 ? "LONG only" : bias == -1 ? "SHORT only" : "NO TRADE",
           DoubleToString(pdh, _Digits), DoubleToString(pdl, _Digits), DoubleToString(hE20, _Digits), hAtr));

   if(inPos || bias == 0) return;

   //--- the just-closed 15M bar, in EAT
   datetime b1 = iTime(_Symbol, PERIOD_M15, 1);
   MqlDateTime s; TimeToStruct(b1 - InpServerGMT * 3600 + 3 * 3600, s);
   int m = s.hour * 60 + s.min;
   bool inWin = (m >= HHMMtoMin(InpLonStart) && m < HHMMtoMin(InpLonEnd)) ||
                (m >= HHMMtoMin(InpNYStart)  && m < HHMMtoMin(InpNYEnd));
   int day = (int)(b1 / 86400);
   if(!inWin || day == lastTradeDay) return;

   double c1 = iClose(_Symbol, PERIOD_M15, 1), c2 = iClose(_Symbol, PERIOD_M15, 2);
   bool trig = false;
   if(InpTrigger == TRIG_PDBREAK)
      trig = (bias == 1) ? (c1 > pdh && c2 <= pdh) : (c1 < pdl && c2 >= pdl);
   else
   {
      double e20 = Buf(hM20, 1);
      double lo4 = iLow(_Symbol, PERIOD_M15, iLowest(_Symbol, PERIOD_M15, MODE_LOW, 4, 1));
      double hi4 = iHigh(_Symbol, PERIOD_M15, iHighest(_Symbol, PERIOD_M15, MODE_HIGH, 4, 1));
      trig = (bias == 1) ? (lo4 <= e20 && c1 > e20 && c1 > iHigh(_Symbol, PERIOD_M15, 2))
                         : (hi4 >= e20 && c1 < e20 && c1 < iLow(_Symbol, PERIOD_M15, 2));
   }
   if(!trig) return;

   double riskPts = InpStopATR * hAtr;
   lastTradeDay = day;

   if(InpMode == RUN_SIGNALS)
   {
      double px = bias == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_ASK) : SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double sl = px - bias * riskPts;
      Alert(StringFormat("%s %s signal · entry ~%s · SL %s (%.1f pts) · exit on H4 close across EMA20",
            _Symbol, bias == 1 ? "BUY" : "SELL", DoubleToString(px, _Digits), DoubleToString(sl, _Digits), riskPts));
      Mark("signal", b1, c1, bias == 1 ? clrTeal : clrRed, bias == 1 ? 233 : 234);
      return;
   }

   double riskMoney = 0;
   double lots = LotsForRisk(riskPts, riskMoney);
   if(lots <= 0) return;
   if(!ReserveSharedSlot()) return;               // shared daily cap across all Gold EAs
   string cmt = "HTF15 R=" + DoubleToString(riskMoney, 2);
   bool ok;
   if(bias == 1)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      ok = trade.Buy(lots, _Symbol, 0, NormalizeDouble(ask - riskPts, _Digits), 0, cmt);
   }
   else
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      ok = trade.Sell(lots, _Symbol, 0, NormalizeDouble(bid + riskPts, _Digits), 0, cmt);
   }
   if(!ok) PrintFormat("Order failed: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//--- R-multiple summary from deal history (prints in Journal; also custom tester criterion)
double BuildRStats(string &report)
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
      long entry = HistoryDealGetInteger(dl, DEAL_ENTRY);
      int k = -1;
      for(int j = 0; j < ArraySize(rPos); j++) if(rPos[j] == pid) { k = j; break; }
      if(k < 0)
      {
         k = ArraySize(rPos);
         ArrayResize(rPos, k + 1); ArrayResize(rRisk, k + 1); ArrayResize(rPnl, k + 1); ArrayResize(rTime, k + 1);
         rPos[k] = pid; rRisk[k] = 0; rPnl[k] = 0; rTime[k] = (datetime)HistoryDealGetInteger(dl, DEAL_TIME);
      }
      if(entry == DEAL_ENTRY_IN)
      {
         string c = HistoryDealGetString(dl, DEAL_COMMENT);
         int p = StringFind(c, "R=");
         if(p >= 0) rRisk[k] = StringToDouble(StringSubstr(c, p + 2));
      }
      rPnl[k] += HistoryDealGetDouble(dl, DEAL_PROFIT) + HistoryDealGetDouble(dl, DEAL_COMMISSION) + HistoryDealGetDouble(dl, DEAL_SWAP);
   }
   int n = 0, w = 0, streak = 0, maxStreak = 0;
   double sum = 0, gw = 0, gl = 0, cum = 0, peak = 0, mdd = 0;
   double yR[]; int yN[]; ArrayResize(yR, 50); ArrayResize(yN, 50); ArrayInitialize(yR, 0); ArrayInitialize(yN, 0);
   for(int k = 0; k < ArraySize(rPos); k++)
   {
      if(rRisk[k] <= 0) continue;
      double r = rPnl[k] / rRisk[k];
      n++; sum += r; cum += r; peak = MathMax(peak, cum); mdd = MathMax(mdd, peak - cum);
      if(r > 0) { w++; gw += r; streak = 0; } else { gl -= r; streak++; maxStreak = MathMax(maxStreak, streak); }
      MqlDateTime s; TimeToStruct(rTime[k], s);
      int yi = s.year - 2000; if(yi >= 0 && yi < 50) { yR[yi] += r; yN[yi]++; }
   }
   report = StringFormat("HTF15 R-summary: trades=%d  win=%.1f%%  netR=%.1f  avgR=%.3f  PF=%.2f  maxDD=%.1fR  longest losing run=%d",
            n, n ? 100.0 * w / n : 0, sum, n ? sum / n : 0, gl > 0 ? gw / gl : 0, mdd, maxStreak);
   for(int yi = 0; yi < 50; yi++)
      if(yN[yi] > 0) report += StringFormat("\n   %d: %d trades, %+.1fR", 2000 + yi, yN[yi], yR[yi]);
   return n ? sum / n : 0;
}


//--- log each closed trade of THIS EA to a CSV (separate tracking per strategy)
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
   long reason = HistoryDealGetInteger(tr.deal, DEAL_REASON);
   string why = reason == DEAL_REASON_SL ? "SL" : reason == DEAL_REASON_TP ? "TP" : "H4 exit/time/manual";
   bool newFile = !FileIsExist(InpLogFile);
   int fh = FileOpen(InpLogFile, FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI, ',');
   if(fh == INVALID_HANDLE) return;
   FileSeek(fh, 0, SEEK_END);
   if(newFile) FileWrite(fh, "strategy", "position", "entry_time", "dir", "entry", "exit_time", "exit", "exit_reason", "lots", "pnl", "risk_money", "R");
   FileWrite(fh, "HTF Bias 15M", (long)pid, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", DoubleToString(pin, _Digits),
             TimeToString((datetime)HistoryDealGetInteger(tr.deal, DEAL_TIME)), DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_PRICE), _Digits),
             why, DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_VOLUME), 2), DoubleToString(pnl, 2), DoubleToString(risk, 2),
             risk > 0 ? DoubleToString(pnl / risk, 2) : "");
   FileClose(fh);
}

double OnTester()
{
   string rep; double avg = BuildRStats(rep);
   Print(rep);
   return avg;                       // "Custom max" criterion = average R per trade
}

void OnDeinit(const int reason)
{
   Comment("");
   if(!MQLInfoInteger(MQL_TESTER)) { string rep; BuildRStats(rep); Print(rep); }
}
//+------------------------------------------------------------------+
