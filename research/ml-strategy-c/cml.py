import sys
s=open(sys.argv[1],encoding='utf-8-sig').read()
def rep(a,b):
    global s
    assert a in s, a[:70]; s=s.replace(a,b,1)
rep('int hD20, hD50, hH20, hH50;','int hD20, hD50, hH20, hH50, hAH1, hAH4, hAD1, hRSI;')
rep('''   if(hD20 == INVALID_HANDLE || hD50 == INVALID_HANDLE || hH20 == INVALID_HANDLE || hH50 == INVALID_HANDLE)''','''   hAH1 = iATR(_Symbol, PERIOD_H1, 14); hAH4 = iATR(_Symbol, PERIOD_H4, 14); hAD1 = iATR(_Symbol, PERIOD_D1, 14); hRSI = iRSI(_Symbol, PERIOD_H1, 14, PRICE_CLOSE);
   if(hD20 == INVALID_HANDLE || hD50 == INVALID_HANDLE || hH20 == INVALID_HANDLE || hH50 == INVALID_HANDLE)''')
feat = r'''   if(!ok) PrintFormat("StratC order failed: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
   else
   {
      // ML dataset: market conditions at entry (all distances in H4 ATR, signed so + = in the trade's favour)
      double d = bias, o1 = iOpen(_Symbol, PERIOD_M15, 1), h1 = iHigh(_Symbol, PERIOD_M15, 1), l1 = iLow(_Symbol, PERIOD_M15, 1);
      double lvl = trig == "PD" ? (bias == 1 ? pdh : pdl) : (bias == 1 ? ah : al);
      double dO = iOpen(_Symbol, PERIOD_D1, 0), pdo = iOpen(_Symbol, PERIOD_D1, 1), pdc = iClose(_Symbol, PERIOD_D1, 1);
      int bi = iBarShift(_Symbol, PERIOD_M15, iTime(_Symbol, PERIOD_D1, 0));
      double dH = bi >= 1 ? iHigh(_Symbol, PERIOD_M15, iHighest(_Symbol, PERIOD_M15, MODE_HIGH, bi, 1)) : h1;
      double dL = bi >= 1 ? iLow(_Symbol, PERIOD_M15, iLowest(_Symbol, PERIOD_M15, MODE_LOW, bi, 1)) : l1;
      double a4[]; double a4avg = 0; int na = CopyBuffer(hAH4, 0, 1, 120, a4); for(int i = 0; i < na; i++) a4avg += a4[i]; a4avg = na > 0 ? a4avg / na : atr;
      double aH1 = Buf(hAH1, 1), aD1 = Buf(hAD1, 1), rsi = Buf(hRSI, 1);
      double room = trig == "AS" ? (bias == 1 ? (pdh - c1) : (c1 - pdl)) / atr : 0;
      double h1c4 = iClose(_Symbol, PERIOD_H1, 5), dc5 = iClose(_Symbol, PERIOD_D1, 5);
      MqlDateTime st; TimeToStruct(b1 - InpServerGMT*3600 + 3*3600, st);
      double sp = SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID);
      PrintFormat("CFEAT|%I64u|%s|%d|%d|%d|%d|%d|%d|%.2f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%.2f|%.4f",
         trade.ResultOrder(), TimeToString(b1), bias, trig == "AS" ? 1 : 0, m, st.day_of_week, today, openN, atr,
         atr / a4avg, aH1 / atr, atr / aD1,
         (c1 - hE20) * d / atr, (c1 - hE50) * d / atr, (c1 - dE20) * d / atr, (c1 - dE50) * d / atr, (hE20 - hE50) * d / atr, (dE20 - dE50) * d / atr,
         (c1 - o1) * d / atr, (h1 - l1) / atr, (c1 - lvl) * d / atr,
         (pdh - pdl) / atr, hasAsia ? (ah - al) / atr : 0, (c1 - dO) * d / atr, (dH - dL) / atr, (pdc - pdo) * d / atr,
         (c1 - h1c4) * d / atr, (c1 - dc5) * d / atr, room, rsi, sp / atr);
   }'''
rep('''   if(!ok) PrintFormat("StratC order failed: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());''', feat)
rep('''PrintFormat("CTRADE|%s|%s|%s|%.2f|%.2f|%s|%.2f|%.3f|%.3f", trg, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", pnl, risk, why, HistoryDealGetDouble(tr.deal, DEAL_VOLUME), mfe, mae);''',
'''PrintFormat("CTRADE|%s|%s|%s|%.2f|%.2f|%s|%.2f|%.3f|%.3f", trg, TimeToString(tin), typ == DEAL_TYPE_BUY ? "BUY" : "SELL", pnl, risk, why, HistoryDealGetDouble(tr.deal, DEAL_VOLUME), mfe, mae);
      PrintFormat("COUT|%I64u|%.4f|%.3f|%.3f|%s", pid, risk > 0 ? pnl / risk : 0, mfe, mae, TimeToString(tout));''')
open(sys.argv[2],'w',encoding='utf-8').write(s)
