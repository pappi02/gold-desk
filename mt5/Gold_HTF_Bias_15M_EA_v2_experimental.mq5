//+------------------------------------------------------------------+
//| Gold HTF Bias · 15M Entry  —  Expert Advisor (MT5)  v2.00         |
//| Bias  : Daily AND H4 agree (close vs EMA50, EMA20 vs EMA50)       |
//| Entry : London / NY window (EAT), 15M close through prev-day H/L  |
//|         (or 15M EMA20 pullback); max 1 trade per day              |
//| Stop  : InpStopATR x ATR14(H4)                                    |
//| Manage: optional breakeven, partial take-profit, ATR trailing     |
//|         stop (chandelier from the best price since entry), fixed  |
//|         final target                                              |
//| Exit  : optional first H4 close back across H4 EMA20; time stop   |
//| Risk  : % of balance, lots from OrderCalcProfit (real contract)   |
//| Time  : server GMT offset auto-detected for EU DST (-1)           |
//| With BE/partial/trail/target all off and EMA exit on, this trades |
//| exactly like v1.11.                                               |
//| Attach to an M15 chart of your gold symbol.                       |
//+------------------------------------------------------------------+
#property copyright "Gold Desk"
#property version   "2.00"   // 2.00: breakeven, partial TP, ATR trail, fixed target, optional EMA exit, auto EU DST
#include <Trade/Trade.mqh>

enum ENUM_RUNMODE { RUN_AUTO = 0,     // Auto-trade
                    RUN_SIGNALS = 1 }; // Signals / alerts only
enum ENUM_TRIGGER { TRIG_PDBREAK = 0,  // Prev-day high/low break
                    TRIG_PULLBACK = 1 }; // 15M EMA20 pullback

input ENUM_RUNMODE InpMode      = RUN_AUTO;     // Mode
input ENUM_TRIGGER InpTrigger   = TRIG_PDBREAK; // Entry trigger
input double InpRiskPct         = 5.0;          // Risk per trade (% of balance)
input double InpStopATR         = 1.0;          // Stop distance (x H4 ATR14)
input double InpTargetR         = 0.0;          // Final target (x stop, 0 = none)
input double InpBreakevenR      = 0.0;          // Move stop to entry at +N R (0 = off)
input double InpPartialPct      = 0.0;          // Partial close: % of position (0 = off)
input double InpPartialR        = 2.0;          // Partial close at +N R
input double InpTrailATR        = 0.0;          // Trail: best price -/+ N x H4 ATR (0 = off)
input double InpTrailStartR     = 1.0;          // Start trailing once at +N R
input bool   InpEMAExit         = true;         // Exit on H4 close back across H4 EMA20
input int    InpMaxDays         = 10;           // Time stop (days)
input int    InpServerGMT       = -1;           // Broker server GMT offset (-1 = auto: 2 winter / 3 EU summer)
input int    InpLonStart        = 1000;         // London window start (EAT, HHMM)
input int    InpLonEnd          = 1400;         // London window end   (EAT, HHMM)
input int    InpNYStart         = 1530;         // NY window start     (EAT, HHMM)
input int    InpNYEnd           = 2000;         // NY window end       (EAT, HHMM)
input bool   InpSkipIfMinLotTooBig = false;     // Skip trade if min lot risks > 2x intended
input long   InpMagic           = 260117;       // Magic number
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

//--- EU summer time: last Sunday of March 01:00 UTC to last Sunday of October 01:00 UTC
datetime LastSunday(const int year, const int month)
{
   MqlDateTime d; ZeroMemory(d);
   d.year = (month == 12) ? year + 1 : year; d.mon = (month == 12) ? 1 : month + 1; d.day = 1;
   datetime last = StructToTime(d) - 86400;
   MqlDateTime l; TimeToStruct(last, l);
   return last - l.day_of_week * 86400;
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

//--- current position of this EA
ulong posTicket = 0;
bool GetPosition(long &dir, datetime &openTime, double &openPrice, double &sl, double &tp, double &vol)
{
   posTicket = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      dir       = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      openTime  = (datetime)PositionGetInteger(POSITION_TIME);
      openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      sl        = PositionGetDouble(POSITION_SL);
      tp        = PositionGetDouble(POSITION_TP);
      vol       = PositionGetDouble(POSITION_VOLUME);
      posTicket = tk;
      return true;
   }
   return false;
}

//--- initial stop distance and volume of a position, from its entry deal (comment "HTF15 R=.. d=..")
bool EntryInfo(const ulong ticket, double &stopDist, double &vol0)
{
   stopDist = 0; vol0 = 0;
   if(!HistorySelectByPosition(ticket)) return false;
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong dl = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(dl, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      vol0 = HistoryDealGetDouble(dl, DEAL_VOLUME);
      string c = HistoryDealGetString(dl, DEAL_COMMENT);
      int p = StringFind(c, "d=");
      if(p >= 0) stopDist = StringToDouble(StringSubstr(c, p + 2));
      return stopDist > 0;
   }
   return false;
}

double LotsForRisk(const double riskPts, double &riskMoney)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double target = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   // Money lost per 1.0 lot at the stop. OrderCalcProfit uses the real contract size;
   // some servers (MetaQuotes-Demo XAUUSD) report a tick value 10x too small.
   double perLot = 0, px = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(OrderCalcProfit(ORDER_TYPE_BUY, _Symbol, 1.0, px, px - riskPts, perLot)) perLot = MathAbs(perLot);
   else
   {
      double tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tickVal <= 0) tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      perLot = riskPts / SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE) * tickVal;
   }
   if(perLot <= 0 || step <= 0) return 0;
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

//--- move the stop only in the trade's favour, keeping the broker's minimum distance
void TightenStop(const long dir, const double cur, const double newSl, const double tp)
{
   double nsl = NormalizeDouble(newSl, _Digits);
   if(cur != 0 && (nsl - cur) * dir <= _Point) return;
   double px = dir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double minGap = (SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) + 1) * _Point;
   if((px - nsl) * dir < minGap) return;
   trade.PositionModify(posTicket, nsl, tp);
}

//--- breakeven / partial / trailing, checked on every tick
void ManagePosition()
{
   if(InpMode != RUN_AUTO) return;
   long dir; datetime openT; double op, sl, tp, vol;
   if(!GetPosition(dir, openT, op, sl, tp, vol)) return;
   if(InpBreakevenR <= 0 && InpPartialPct <= 0 && InpTrailATR <= 0) return;
   double d, vol0;
   if(!EntryInfo(posTicket, d, vol0)) return;
   GetPosition(dir, openT, op, sl, tp, vol);                 // HistorySelect may have reset the selection
   double px = dir == 1 ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double rNow = (px - op) * dir / d;

   // partial take-profit (once: only while the full volume is still open)
   if(InpPartialPct > 0 && rNow >= InpPartialR && vol >= vol0 - 1e-8)
   {
      double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double part = MathFloor(vol * InpPartialPct / 100.0 / step) * step;
      if(part >= vmin && vol - part >= vmin - 1e-8)
      {
         trade.PositionClosePartial(posTicket, NormalizeDouble(part, 2));
         if(!GetPosition(dir, openT, op, sl, tp, vol)) return;
      }
   }
   // breakeven
   if(InpBreakevenR > 0 && rNow >= InpBreakevenR && (sl == 0 || (op - sl) * dir > 0))
   {
      TightenStop(dir, sl, op + dir * 2 * _Point, tp);
      if(!GetPosition(dir, openT, op, sl, tp, vol)) return;
   }
   // ATR chandelier trail from the best price since entry
   if(InpTrailATR > 0)
   {
      int bars = iBarShift(_Symbol, PERIOD_M15, openT, false);
      if(bars < 0) return;
      double best = dir == 1 ? iHigh(_Symbol, PERIOD_M15, iHighest(_Symbol, PERIOD_M15, MODE_HIGH, bars + 1, 0))
                             : iLow(_Symbol, PERIOD_M15, iLowest(_Symbol, PERIOD_M15, MODE_LOW, bars + 1, 0));
      double atr = Buf(hATR, 1);
      if(atr == EMPTY_VALUE || (best - op) * dir < InpTrailStartR * d) return;
      TightenStop(dir, sl, best - dir * InpTrailATR * atr, tp);
   }
}

void OnTick()
{
   ManagePosition();

   datetime t0 = iTime(_Symbol, PERIOD_M15, 0);
   if(t0 == 0 || t0 == lastM15) return;             // signals once per new 15M bar
   lastM15 = t0;

   //--- higher timeframe values from COMPLETED bars (shift 1)
   double dC = iClose(_Symbol, PERIOD_D1, 1), dE20 = Buf(hD20, 1), dE50 = Buf(hD50, 1);
   double hC = iClose(_Symbol, PERIOD_H4, 1), hE20 = Buf(hH20, 1), hE50 = Buf(hH50, 1), hAtr = Buf(hATR, 1);
   double pdh = iHigh(_Symbol, PERIOD_D1, 1), pdl = iLow(_Symbol, PERIOD_D1, 1);
   if(dE50 == EMPTY_VALUE || hE50 == EMPTY_VALUE || hAtr == EMPTY_VALUE) return;

   int dT = (dC > dE50 && dE20 > dE50) ? 1 : (dC < dE50 && dE20 < dE50) ? -1 : 0;
   int hT = (hC > hE50 && hE20 > hE50) ? 1 : (hC < hE50 && hE20 < hE50) ? -1 : 0;
   int bias = (dT == hT) ? dT : 0;

   long dir; datetime openT; double op, sl, tp, vol;
   bool inPos = GetPosition(dir, openT, op, sl, tp, vol);

   //--- exits
   if(inPos)
   {
      datetime h4Open1 = iTime(_Symbol, PERIOD_H4, 1);
      bool emaExit  = InpEMAExit && (h4Open1 >= openT) && ((hC - hE20) * dir < 0);
      bool timeExit = (t0 - openT) >= InpMaxDays * 86400;
      if(emaExit || timeExit)
      {
         if(InpMode == RUN_AUTO) trade.PositionClose(posTicket);
         if(InpMode == RUN_SIGNALS || !MQLInfoInteger(MQL_TESTER))
            Alert(_Symbol, emaExit ? ": EXIT — H4 closed back across EMA20" : ": EXIT — time stop");
      }
   }

   //--- comment panel
   Comment(StringFormat("Gold HTF Bias · 15M v2\nBias (D+H4): %s\nPrev day H/L: %s / %s\nH4 EMA20: %s   H4 ATR: %.2f\nBalance: %.2f   Equity: %.2f",
           bias == 1 ? "LONG only" : bias == -1 ? "SHORT only" : "NO TRADE",
           DoubleToString(pdh, _Digits), DoubleToString(pdl, _Digits), DoubleToString(hE20, _Digits), hAtr,
           AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY)));

   if(inPos || bias == 0) return;

   //--- the just-closed 15M bar, in EAT
   datetime b1 = iTime(_Symbol, PERIOD_M15, 1);
   MqlDateTime s; TimeToStruct(b1 - ServerGMT(b1) * 3600 + 3 * 3600, s);
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
      double slp = px - bias * riskPts;
      Alert(StringFormat("%s %s signal · entry ~%s · SL %s (%.1f pts)", _Symbol, bias == 1 ? "BUY" : "SELL",
            DoubleToString(px, _Digits), DoubleToString(slp, _Digits), riskPts));
      Mark("signal", b1, c1, bias == 1 ? clrTeal : clrRed, bias == 1 ? 233 : 234);
      return;
   }

   double riskMoney = 0;
   double lots = LotsForRisk(riskPts, riskMoney);
   if(lots <= 0) return;
   string cmt = "HTF15 R=" + DoubleToString(riskMoney, 2) + " d=" + DoubleToString(riskPts, 2);
   bool ok;
   if(bias == 1)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double tpp = InpTargetR > 0 ? NormalizeDouble(ask + InpTargetR * riskPts, _Digits) : 0;
      ok = trade.Buy(lots, _Symbol, 0, NormalizeDouble(ask - riskPts, _Digits), tpp, cmt);
   }
   else
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double tpp = InpTargetR > 0 ? NormalizeDouble(bid - InpTargetR * riskPts, _Digits) : 0;
      ok = trade.Sell(lots, _Symbol, 0, NormalizeDouble(bid + riskPts, _Digits), tpp, cmt);
   }
   if(!ok) PrintFormat("Order failed: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
}

//--- R-multiple summary from deal history (prints in Journal; also custom tester criterion)
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
   trades = n;
   report = StringFormat("HTF15 R-summary: trades=%d  win=%.1f%%  netR=%.1f  avgR=%.3f  PF=%.2f  maxDD=%.1fR  longest losing run=%d",
            n, n ? 100.0 * w / n : 0, sum, n ? sum / n : 0, gl > 0 ? gw / gl : 0, mdd, maxStreak);
   for(int yi = 0; yi < 50; yi++)
      if(yN[yi] > 0) report += StringFormat("\n   %d: %d trades, %+.1fR", 2000 + yi, yN[yi], yR[yi]);
   return n ? sum / n : 0;
}

//--- log each fully closed trade of THIS EA to a CSV (separate tracking per strategy)
void OnTradeTransaction(const MqlTradeTransaction &tr, const MqlTradeRequest &rq, const MqlTradeResult &rs)
{
   if(tr.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION)) return;   // no CSV during tests
   if(!HistoryDealSelect(tr.deal)) return;
   if(HistoryDealGetInteger(tr.deal, DEAL_MAGIC) != InpMagic) return;
   if(HistoryDealGetInteger(tr.deal, DEAL_ENTRY) != DEAL_ENTRY_OUT) return;
   ulong pid = (ulong)HistoryDealGetInteger(tr.deal, DEAL_POSITION_ID);
   if(PositionSelectByTicket(pid)) return;          // partial close: log when the whole position is done
   double risk = 0, pin = 0, pnl = 0, lots = 0; datetime tin = 0; long typ = 0;
   if(HistorySelectByPosition(pid))
      for(int i = 0; i < HistoryDealsTotal(); i++)
      {
         ulong dl = HistoryDealGetTicket(i);
         pnl += HistoryDealGetDouble(dl, DEAL_PROFIT) + HistoryDealGetDouble(dl, DEAL_COMMISSION) + HistoryDealGetDouble(dl, DEAL_SWAP);
         if(HistoryDealGetInteger(dl, DEAL_ENTRY) == DEAL_ENTRY_IN)
         {
            string c = HistoryDealGetString(dl, DEAL_COMMENT); int p = StringFind(c, "R=");
            if(p >= 0) risk = StringToDouble(StringSubstr(c, p + 2));
            tin = (datetime)HistoryDealGetInteger(dl, DEAL_TIME); pin = HistoryDealGetDouble(dl, DEAL_PRICE);
            typ = HistoryDealGetInteger(dl, DEAL_TYPE); lots = HistoryDealGetDouble(dl, DEAL_VOLUME);
         }
      }
   HistoryDealSelect(tr.deal);
   long reason = HistoryDealGetInteger(tr.deal, DEAL_REASON);
   string why = reason == DEAL_REASON_SL ? "SL/BE/trail" : reason == DEAL_REASON_TP ? "TP" : "H4 exit/time/manual";
   bool newFile = !FileIsExist(InpLogFile);
   int fh = FileOpen(InpLogFile, FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(fh == INVALID_HANDLE) return;
   FileSeek(fh, 0, SEEK_END);
   if(newFile) FileWrite(fh, "strategy", "position", "entry_time", "dir", "entry", "exit_time", "exit", "exit_reason", "lots", "pnl", "risk_money", "R");
   FileWrite(fh, "HTF Bias 15M v2", (long)pid, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", DoubleToString(pin, _Digits),
             TimeToString((datetime)HistoryDealGetInteger(tr.deal, DEAL_TIME)), DoubleToString(HistoryDealGetDouble(tr.deal, DEAL_PRICE), _Digits),
             why, DoubleToString(lots, 2), DoubleToString(pnl, 2), DoubleToString(risk, 2),
             risk > 0 ? DoubleToString(pnl / risk, 2) : "");
   FileClose(fh);
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
