//+------------------------------------------------------------------+
//| Gold Desk Exporter  —  MT5 service (read-only, never trades)      |
//| Every InpIntervalMs writes MQL5/Files/<InpFile> (UTF-8 JSON) with |
//| account, terminal status, market state, open positions, the full  |
//| deal history and the shared daily-cap usage, for the dashboard.   |
//| Install: MQL5/Services, then Navigator > Services > Add Service.  |
//+------------------------------------------------------------------+
#property service
#property copyright "Gold Desk"
#property version   "1.20"

input string InpSymbol     = "XAUUSD";                  // Symbol to describe
input int    InpIntervalMs = 2000;                      // Export interval (ms)
input string InpFile       = "golddesk.json";           // Output file (MQL5/Files)
input string InpCapMagics  = "260117,260118,260119";    // Magics sharing the daily cap
input int    InpMaxAllPerDay = 4;                       // Shared daily cap (for display)
input int    InpBarsEverySec = 30;                      // Candle history file interval (s)
input string InpBarsFile   = "golddesk_bars.json";      // Candle history for the chart page

string Q(string s)
{
   StringReplace(s, "\\", "\\\\"); StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");    StringReplace(s, "\n", " ");    StringReplace(s, "\t", " ");
   return "\"" + s + "\"";
}
string N(const double v, const int d)
{
   if(v == EMPTY_VALUE || !MathIsValidNumber(v)) return "null";
   return DoubleToString(v, d);
}
string I(const long v) { return IntegerToString(v); }
string B(const bool v) { return v ? "true" : "false"; }
double Buf(const int h, const int sh)
{
   double b[];
   if(h == INVALID_HANDLE || CopyBuffer(h, 0, sh, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}
int Trend(const double c, const double e20, const double e50)
{
   if(c == EMPTY_VALUE || e20 == EMPTY_VALUE || e50 == EMPTY_VALUE || c == 0) return 0;
   return (c > e50 && e20 > e50) ? 1 : (c < e50 && e20 < e50) ? -1 : 0;
}

//--- per-position excursion: farthest price reached in favour (best) and against (worst)
//    between entry and exit. Edge minutes use ticks, the middle uses M1 bars (bid prices).
struct PosInfo { long id; int dir; long inMsc; long outMsc; bool hasOut; };
long   gExcId[];    // cache for closed positions (their excursion never changes)
string gExcJs[];

void Take(const int dir, const double hi, const double lo, const long t, double &best, long &bestT, double &worst, long &worstT)
{
   double fav = dir > 0 ? hi : lo, adv = dir > 0 ? lo : hi;
   if((fav - best) * dir > 0) { best = fav; bestT = t; }
   if((adv - worst) * dir < 0) { worst = adv; worstT = t; }
}
// returns false if tick history was not ready (result is then approximate and not cached)
bool TickSpan(const string sym, const int dir, const long fromMsc, const long toMsc, double &best, long &bestT, double &worst, long &worstT)
{
   if(toMsc < fromMsc) return true;
   MqlTick tk[];
   int n = CopyTicksRange(sym, tk, COPY_TICKS_INFO, (ulong)fromMsc, (ulong)toMsc);
   if(n > 0)
   {
      for(int i = 0; i < n; i++) if(tk[i].bid > 0) Take(dir, tk[i].bid, tk[i].bid, (long)(tk[i].time_msc / 1000), best, bestT, worst, worstT);
      return true;
   }
   MqlRates r[];                                         // fall back to the minute bar(s)
   if(CopyRates(sym, PERIOD_M1, (datetime)(fromMsc / 1000), (datetime)(toMsc / 1000), r) > 0)
      for(int i = 0; i < ArraySize(r); i++) Take(dir, r[i].high, r[i].low, (long)r[i].time, best, bestT, worst, worstT);
   return n == 0;
}
bool Excursion(const string sym, const int dir, const long inMsc, const long outMsc, double &best, long &bestT, double &worst, long &worstT)
{
   best = dir > 0 ? -DBL_MAX : DBL_MAX; worst = -best; bestT = 0; worstT = 0;
   long f = inMsc / 1000, t = outMsc / 1000;
   long fEnd = f - f % 60 + 60, tStart = t - t % 60;      // end of entry minute, start of exit minute
   if(tStart <= fEnd) return TickSpan(sym, dir, inMsc, outMsc, best, bestT, worst, worstT);
   bool ok = TickSpan(sym, dir, inMsc, fEnd * 1000 - 1, best, bestT, worst, worstT);
   if(tStart - 60 >= fEnd)
   {
      MqlRates r[];
      int n = CopyRates(sym, PERIOD_M1, (datetime)fEnd, (datetime)(tStart - 60), r);
      if(n <= 0) { n = CopyRates(sym, PERIOD_M15, (datetime)fEnd, (datetime)(tStart - 60), r); ok = false; }
      for(int i = 0; i < n; i++) Take(dir, r[i].high, r[i].low, (long)r[i].time, best, bestT, worst, worstT);
   }
   ok = TickSpan(sym, dir, tStart * 1000, outMsc, best, bestT, worst, worstT) && ok;
   return ok;
}
int FindPos(PosInfo &p[], const long id) { for(int i = 0; i < ArraySize(p); i++) if(p[i].id == id) return i; return -1; }
int FindCache(const long id) { for(int i = 0; i < ArraySize(gExcId); i++) if(gExcId[i] == id) return i; return -1; }

//--- candle history for the dashboard chart: [time(server), o, h, l, c] per timeframe
string BarsJs(const string sym, const ENUM_TIMEFRAMES tf, const int count, const int digits)
{
   MqlRates r[]; ArraySetAsSeries(r, false);
   int n = CopyRates(sym, tf, 0, count, r);
   string js = "[";
   for(int i = 0; i < n; i++)
      js += (i > 0 ? "," : "") + "[" + IntegerToString((long)r[i].time) + "," + DoubleToString(r[i].open, digits) + "," + DoubleToString(r[i].high, digits)
          + "," + DoubleToString(r[i].low, digits) + "," + DoubleToString(r[i].close, digits) + "]";
   return js + "]";
}
void WriteBars(const string sym, const int offset)
{
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   string js = "{\"symbol\":\"" + sym + "\",\"server_gmt_offset\":" + IntegerToString(offset) + ",\"written\":" + IntegerToString((long)TimeTradeServer()) + ",\"tf\":{"
             + "\"M5\":"  + BarsJs(sym, PERIOD_M5, 3000, dg)  + ",\"M15\":" + BarsJs(sym, PERIOD_M15, 3000, dg)
             + ",\"H1\":" + BarsJs(sym, PERIOD_H1, 2500, dg)  + ",\"H4\":"  + BarsJs(sym, PERIOD_H4, 1500, dg)
             + ",\"D1\":" + BarsJs(sym, PERIOD_D1, 600, dg)   + "}}";
   uchar buf[]; int len = StringToCharArray(js, buf, 0, WHOLE_ARRAY, CP_UTF8);
   int fh = FileOpen("golddesk_bars.tmp", FILE_WRITE | FILE_BIN);
   if(fh == INVALID_HANDLE) return;
   FileWriteArray(fh, buf, 0, MathMax(len - 1, 0));
   FileClose(fh);
   FileMove("golddesk_bars.tmp", 0, InpBarsFile, FILE_REWRITE);
}

void OnStart()
{
   string sym = InpSymbol;
   SymbolSelect(sym, true);
   int hD20 = iMA(sym, PERIOD_D1, 20, 0, MODE_EMA, PRICE_CLOSE), hD50 = iMA(sym, PERIOD_D1, 50, 0, MODE_EMA, PRICE_CLOSE);
   int hH20 = iMA(sym, PERIOD_H4, 20, 0, MODE_EMA, PRICE_CLOSE), hH50 = iMA(sym, PERIOD_H4, 50, 0, MODE_EMA, PRICE_CLOSE);
   int hATR4 = iATR(sym, PERIOD_H4, 14), hATR1 = iATR(sym, PERIOD_H1, 14);
   string capMagics[]; int nCap = StringSplit(InpCapMagics, ',', capMagics);
   long seq = 0;
   datetime lastBars = 0;

   while(!IsStopped())
   {
      seq++;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      datetime srv = TimeTradeServer(), gmt = TimeGMT();
      int offset = (int)MathRound((double)(srv - gmt) / 3600.0);

      string js = "{";
      js += "\"version\":1,\"seq\":" + I(seq) + ",\"server_time\":" + I((long)srv) + ",\"gmt_time\":" + I((long)gmt) + ",\"server_gmt_offset\":" + I(offset) + ",";

      //--- terminal + account
      js += "\"terminal\":{\"connected\":" + B(TerminalInfoInteger(TERMINAL_CONNECTED) != 0)
          + ",\"algo_trading\":" + B(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0)
          + ",\"ping_ms\":" + N(TerminalInfoInteger(TERMINAL_PING_LAST) / 1000.0, 1)
          + ",\"build\":" + I(TerminalInfoInteger(TERMINAL_BUILD)) + "},";
      long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
      js += "\"account\":{\"login\":" + I(AccountInfoInteger(ACCOUNT_LOGIN))
          + ",\"name\":" + Q(AccountInfoString(ACCOUNT_NAME))
          + ",\"server\":" + Q(AccountInfoString(ACCOUNT_SERVER))
          + ",\"company\":" + Q(AccountInfoString(ACCOUNT_COMPANY))
          + ",\"currency\":" + Q(AccountInfoString(ACCOUNT_CURRENCY))
          + ",\"mode\":" + Q(mode == ACCOUNT_TRADE_MODE_DEMO ? "demo" : mode == ACCOUNT_TRADE_MODE_CONTEST ? "contest" : "real")
          + ",\"leverage\":" + I(AccountInfoInteger(ACCOUNT_LEVERAGE))
          + ",\"trade_allowed\":" + B(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0)
          + ",\"expert_allowed\":" + B(AccountInfoInteger(ACCOUNT_TRADE_EXPERT) != 0)
          + ",\"balance\":" + N(AccountInfoDouble(ACCOUNT_BALANCE), 2)
          + ",\"equity\":" + N(AccountInfoDouble(ACCOUNT_EQUITY), 2)
          + ",\"profit\":" + N(AccountInfoDouble(ACCOUNT_PROFIT), 2)
          + ",\"margin\":" + N(AccountInfoDouble(ACCOUNT_MARGIN), 2)
          + ",\"free_margin\":" + N(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2)
          + ",\"margin_level\":" + N(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2) + "},";

      //--- market
      MqlTick tk; bool hasTick = SymbolInfoTick(sym, tk);
      double d1c = iClose(sym, PERIOD_D1, 1), d20 = Buf(hD20, 1), d50 = Buf(hD50, 1);
      double h4c = iClose(sym, PERIOD_H4, 1), h20 = Buf(hH20, 1), h50 = Buf(hH50, 1);
      int dT = Trend(d1c, d20, d50), hT = Trend(h4c, h20, h50);
      double pt = SymbolInfoDouble(sym, SYMBOL_POINT);
      js += "\"market\":{\"symbol\":" + Q(sym) + ",\"digits\":" + I(digits)
          + ",\"bid\":" + (hasTick ? N(tk.bid, digits) : "null") + ",\"ask\":" + (hasTick ? N(tk.ask, digits) : "null")
          + ",\"tick_time\":" + (hasTick ? I((long)tk.time) : "null")
          + ",\"spread\":" + (hasTick ? N(tk.ask - tk.bid, digits) : "null")
          + ",\"contract_size\":" + N(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 2)
          + ",\"min_lot\":" + N(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), 2)
          + ",\"day_open\":" + N(iOpen(sym, PERIOD_D1, 0), digits) + ",\"day_high\":" + N(iHigh(sym, PERIOD_D1, 0), digits) + ",\"day_low\":" + N(iLow(sym, PERIOD_D1, 0), digits)
          + ",\"prev_high\":" + N(iHigh(sym, PERIOD_D1, 1), digits) + ",\"prev_low\":" + N(iLow(sym, PERIOD_D1, 1), digits) + ",\"prev_close\":" + N(d1c, digits)
          + ",\"d1\":{\"close\":" + N(d1c, digits) + ",\"ema20\":" + N(d20, digits) + ",\"ema50\":" + N(d50, digits) + ",\"trend\":" + I(dT) + "}"
          + ",\"h4\":{\"close\":" + N(h4c, digits) + ",\"ema20\":" + N(h20, digits) + ",\"ema50\":" + N(h50, digits) + ",\"trend\":" + I(hT) + "}"
          + ",\"bias\":" + I(dT == hT ? dT : 0)
          + ",\"atr_h4\":" + N(Buf(hATR4, 1), 2) + ",\"atr_h1\":" + N(Buf(hATR1, 1), 2) + "},";

      //--- recent M15 bars (for the Asian range and the mini chart): last 96 (one day)
      MqlRates r[]; ArraySetAsSeries(r, false);
      int nr = CopyRates(sym, PERIOD_M15, 0, 96, r);
      js += "\"m15\":[";
      for(int i = 0; i < nr; i++)
         js += (i > 0 ? "," : "") + "[" + I((long)r[i].time) + "," + N(r[i].open, digits) + "," + N(r[i].high, digits) + "," + N(r[i].low, digits) + "," + N(r[i].close, digits) + "]";
      js += "],";

      //--- open positions
      js += "\"positions\":[";
      int np = 0;
      for(int i = 0; i < PositionsTotal(); i++)
      {
         ulong t = PositionGetTicket(i); if(t == 0) continue;
         js += (np++ > 0 ? "," : "") + "{\"ticket\":" + I((long)t)
             + ",\"position_id\":" + I(PositionGetInteger(POSITION_IDENTIFIER))
             + ",\"symbol\":" + Q(PositionGetString(POSITION_SYMBOL))
             + ",\"magic\":" + I(PositionGetInteger(POSITION_MAGIC))
             + ",\"type\":" + Q(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "buy" : "sell")
             + ",\"volume\":" + N(PositionGetDouble(POSITION_VOLUME), 2)
             + ",\"price_open\":" + N(PositionGetDouble(POSITION_PRICE_OPEN), digits)
             + ",\"price_current\":" + N(PositionGetDouble(POSITION_PRICE_CURRENT), digits)
             + ",\"sl\":" + N(PositionGetDouble(POSITION_SL), digits) + ",\"tp\":" + N(PositionGetDouble(POSITION_TP), digits)
             + ",\"profit\":" + N(PositionGetDouble(POSITION_PROFIT), 2) + ",\"swap\":" + N(PositionGetDouble(POSITION_SWAP), 2)
             + ",\"time\":" + I(PositionGetInteger(POSITION_TIME)) + ",\"time_update\":" + I(PositionGetInteger(POSITION_TIME_UPDATE))
             + ",\"comment\":" + Q(PositionGetString(POSITION_COMMENT)) + "}";
      }
      js += "],";

      //--- deal history (everything on the account)
      js += "\"deals\":[";
      int nd = 0, capUsed = 0;
      PosInfo P[];
      datetime d0 = iTime(sym, PERIOD_D1, 0);
      if(HistorySelect(0, TimeCurrent() + 86400))
         for(int i = 0; i < HistoryDealsTotal(); i++)
         {
            ulong dl = HistoryDealGetTicket(i); if(dl == 0) continue;
            long entry = HistoryDealGetInteger(dl, DEAL_ENTRY), mg = HistoryDealGetInteger(dl, DEAL_MAGIC);
            datetime dt = (datetime)HistoryDealGetInteger(dl, DEAL_TIME);
            long dtype = HistoryDealGetInteger(dl, DEAL_TYPE), pid = HistoryDealGetInteger(dl, DEAL_POSITION_ID);
            if((dtype == DEAL_TYPE_BUY || dtype == DEAL_TYPE_SELL) && HistoryDealGetString(dl, DEAL_SYMBOL) == sym)
            {
               int k = FindPos(P, pid);
               if(k < 0) { k = ArraySize(P); ArrayResize(P, k + 1); P[k].id = pid; P[k].dir = 0; P[k].inMsc = 0; P[k].outMsc = 0; P[k].hasOut = false; }
               long msc = HistoryDealGetInteger(dl, DEAL_TIME_MSC);
               if(entry == DEAL_ENTRY_IN) { P[k].inMsc = msc; P[k].dir = dtype == DEAL_TYPE_BUY ? 1 : -1; }
               else if(msc > P[k].outMsc) { P[k].outMsc = msc; P[k].hasOut = true; }
            }
            if(entry == DEAL_ENTRY_IN && dt >= d0 && HistoryDealGetString(dl, DEAL_SYMBOL) == sym)
               for(int j = 0; j < nCap; j++) if(StringToInteger(capMagics[j]) == mg) { capUsed++; break; }
            js += (nd++ > 0 ? "," : "") + "{\"ticket\":" + I((long)dl)
                + ",\"order\":" + I(HistoryDealGetInteger(dl, DEAL_ORDER))
                + ",\"position_id\":" + I(HistoryDealGetInteger(dl, DEAL_POSITION_ID))
                + ",\"time\":" + I((long)dt) + ",\"time_msc\":" + I(HistoryDealGetInteger(dl, DEAL_TIME_MSC))
                + ",\"type\":" + I(HistoryDealGetInteger(dl, DEAL_TYPE)) + ",\"entry\":" + I(entry)
                + ",\"reason\":" + I(HistoryDealGetInteger(dl, DEAL_REASON))
                + ",\"magic\":" + I(mg) + ",\"symbol\":" + Q(HistoryDealGetString(dl, DEAL_SYMBOL))
                + ",\"volume\":" + N(HistoryDealGetDouble(dl, DEAL_VOLUME), 2)
                + ",\"price\":" + N(HistoryDealGetDouble(dl, DEAL_PRICE), digits)
                + ",\"sl\":" + N(HistoryDealGetDouble(dl, DEAL_SL), digits) + ",\"tp\":" + N(HistoryDealGetDouble(dl, DEAL_TP), digits)
                + ",\"profit\":" + N(HistoryDealGetDouble(dl, DEAL_PROFIT), 2)
                + ",\"commission\":" + N(HistoryDealGetDouble(dl, DEAL_COMMISSION), 2)
                + ",\"swap\":" + N(HistoryDealGetDouble(dl, DEAL_SWAP), 2)
                + ",\"fee\":" + N(HistoryDealGetDouble(dl, DEAL_FEE), 2)
                + ",\"comment\":" + Q(HistoryDealGetString(dl, DEAL_COMMENT)) + "}";
         }
      js += "],";

      //--- excursions (open positions: so far; closed: cached once computed from full tick data)
      js += "\"excursions\":[";
      int ne = 0;
      long nowMsc = (long)TimeTradeServer() * 1000;
      if(hasTick && tk.time_msc > 0) nowMsc = (long)tk.time_msc;
      for(int i = 0; i < ArraySize(P); i++)
      {
         if(P[i].dir == 0 || P[i].inMsc == 0) continue;
         bool isOpen = PositionSelectByTicket((ulong)P[i].id) || !P[i].hasOut;
         string one = "";
         int c = isOpen ? -1 : FindCache(P[i].id);
         if(c >= 0) one = gExcJs[c];
         else
         {
            double best, worst; long bt, wt;
            bool ok = Excursion(sym, P[i].dir, P[i].inMsc, isOpen ? nowMsc : P[i].outMsc, best, bt, worst, wt);
            if(bt == 0) continue;
            one = "{\"position_id\":" + I(P[i].id) + ",\"best\":" + N(best, digits) + ",\"best_time\":" + I(bt)
                + ",\"worst\":" + N(worst, digits) + ",\"worst_time\":" + I(wt) + ",\"open\":" + B(isOpen) + ",\"exact\":" + B(ok) + "}";
            if(!isOpen && ok) { int k = ArraySize(gExcId); ArrayResize(gExcId, k + 1); ArrayResize(gExcJs, k + 1); gExcId[k] = P[i].id; gExcJs[k] = one; }
         }
         js += (ne++ > 0 ? "," : "") + one;
      }
      js += "],";

      //--- shared daily cap (same key the EAs use)
      string key = "GoldCap_" + sym + "_" + IntegerToString((long)(d0 / 86400));
      double gv = GlobalVariableCheck(key) ? GlobalVariableGet(key) : 0;
      js += "\"cap\":{\"max\":" + I(InpMaxAllPerDay) + ",\"used\":" + I((long)MathMax(gv, capUsed))
          + ",\"deals_today\":" + I(capUsed) + ",\"reserved\":" + N(gv, 0) + ",\"day_start\":" + I((long)d0) + "}";
      js += "}";

      //--- write atomically: temp file then rename
      uchar buf[]; int len = StringToCharArray(js, buf, 0, WHOLE_ARRAY, CP_UTF8);
      int fh = FileOpen("golddesk.tmp", FILE_WRITE | FILE_BIN);
      if(fh != INVALID_HANDLE)
      {
         FileWriteArray(fh, buf, 0, MathMax(len - 1, 0));     // drop the trailing NUL
         FileClose(fh);
         FileMove("golddesk.tmp", 0, InpFile, FILE_REWRITE);
      }
      if(TimeLocal() - lastBars >= InpBarsEverySec) { WriteBars(sym, offset); lastBars = TimeLocal(); }
      Sleep(InpIntervalMs);
   }
}
//+------------------------------------------------------------------+
