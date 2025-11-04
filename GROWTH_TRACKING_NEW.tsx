              <>
                {/* Time Period Filter */}
                <div className="flex justify-end items-center mb-6">
                  <Select value={growthDays.toString()} onValueChange={(value) => setGrowthDays(parseInt(value))}>
                    <SelectTrigger className="w-[200px] bg-slate-800/80 text-white border-white/30">
                      <SelectValue placeholder="Time period" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 text-white border-white/30">
                      <SelectItem value="0">All Time</SelectItem>
                      <SelectItem value="90">Last 90 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="7">Last 7 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* DUAL SIDE-BY-SIDE LAYOUT */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* LEFT SIDE: FXIFY PERFORMANCE (PRIMARY) */}
                  <div className="space-y-6">
                    <Card className="bg-gradient-to-br from-green-900/40 to-emerald-900/40 border-green-500/50 backdrop-blur-md shadow-2xl">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div>
                            <Badge className="bg-green-500/80 text-white mb-2">🎯 FXIFY TRADING</Badge>
                            <CardTitle className="text-white text-2xl">Real Trading Performance</CardTitle>
                            <CardDescription className="text-green-200 mt-1">
                              HIGH tier signals (80+) sent to broker • {dualGrowthStats.timeframe}
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const fxify = dualGrowthStats.fxifyOnly.overall;
                          const profitCalc = calculateFxifyProfit(fxify.totalProfitPips, fxify.totalSignals, 100000, 3);
                          const requirements = meetsFxifyRequirements(fxify.winRate, fxify.profitFactor, fxify.maxDrawdown, 100000);

                          return (
                            <div className="space-y-6">
                              {/* Key Metrics */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Total Profit</p>
                                  <p className={`text-3xl font-black ${fxify.totalProfitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {formatDollars(profitCalc.totalDollars)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    {fxify.totalProfitPips >= 0 ? '+' : ''}{fxify.totalProfitPips.toFixed(1)} pips
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Win Rate</p>
                                  <p className="text-3xl font-black text-white">{fxify.winRate.toFixed(1)}%</p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    {fxify.wins}W / {fxify.losses}L
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Monthly Projection</p>
                                  <p className="text-2xl font-black text-green-400">
                                    {formatDollars(profitCalc.monthlyDollars)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    Based on {profitCalc.projectedMonthlyTrades} trades/mo
                                  </p>
                                </div>
                                <div className="bg-slate-900/50 p-4 rounded-lg">
                                  <p className="text-xs text-green-300 mb-1">Profit Factor</p>
                                  <p className={`text-2xl font-black ${
                                    fxify.profitFactor >= 2.5 ? 'text-green-400' :
                                    fxify.profitFactor >= 1.5 ? 'text-yellow-400' :
                                    'text-red-400'
                                  }`}>
                                    {fxify.profitFactor.toFixed(2)}
                                  </p>
                                  <p className="text-xs text-slate-400 mt-1">
                                    {fxify.profitFactor >= 2.5 ? '⭐ Excellent' :
                                     fxify.profitFactor >= 1.5 ? '✓ Good' :
                                     '✗ Below Target'}
                                  </p>
                                </div>
                              </div>

                              {/* FXIFY Readiness */}
                              <div className={`p-4 rounded-lg border-2 ${
                                requirements.meetsRequirements
                                  ? 'bg-green-900/20 border-green-500/50'
                                  : 'bg-yellow-900/20 border-yellow-500/50'
                              }`}>
                                <p className="font-semibold text-white mb-2">
                                  {requirements.meetsRequirements ? '✅ FXIFY Ready' : '⚠️ Needs Improvement'}
                                </p>
                                {requirements.issues.length > 0 && (
                                  <ul className="text-xs text-yellow-300 space-y-1">
                                    {requirements.issues.map((issue, idx) => (
                                      <li key={idx}>• {issue}</li>
                                    ))}
                                  </ul>
                                )}
                                {requirements.meetsRequirements && (
                                  <p className="text-xs text-green-300">All FXIFY requirements met</p>
                                )}
                              </div>

                              {/* Stats Summary */}
                              <div className="flex justify-between text-xs text-green-300">
                                <div>
                                  <span className="text-slate-400">Signals:</span> {fxify.totalSignals}
                                </div>
                                <div>
                                  <span className="text-slate-400">Avg Win:</span> +{fxify.avgWinPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-400">Avg Loss:</span> -{fxify.avgLossPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-400">Max DD:</span> -{fxify.maxDrawdown.toFixed(1)}p
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>

                    {/* FXIFY Symbol Performance */}
                    <Card className="bg-slate-800/80 border-green-500/30 shadow-xl">
                      <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2">
                          <Target className="w-5 h-5 text-green-400" />
                          FXIFY Symbol Performance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-slate-700">
                                <th className="text-left py-2 px-3 text-sm font-semibold text-slate-300">Symbol</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-300">Signals</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-300">Win Rate</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-300">Profit (pips)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dualGrowthStats.fxifyOnly.symbolPerformance.map((symbol, idx) => {
                                const profitPips = parseFloat(symbol.profit_pips);
                                const winRate = parseFloat(symbol.win_rate);
                                return (
                                  <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                                    <td className="py-2 px-3 font-semibold text-white">{symbol.symbol}</td>
                                    <td className="py-2 px-3 text-center text-slate-300">{symbol.total_signals}</td>
                                    <td className="py-2 px-3 text-center">
                                      <span className={`font-semibold ${
                                        winRate >= 50 ? 'text-green-400' :
                                        winRate >= 40 ? 'text-yellow-400' :
                                        'text-red-400'
                                      }`}>
                                        {winRate.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <span className={`font-bold ${profitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {profitPips >= 0 ? '+' : ''}{profitPips.toFixed(1)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* RIGHT SIDE: ALL SIGNALS (SECONDARY) */}
                  <div className="space-y-6">
                    <Card className="bg-slate-800/60 border-slate-600/50 backdrop-blur-md shadow-xl">
                      <CardHeader>
                        <div>
                          <Badge className="bg-slate-500/80 text-white mb-2">📊 SYSTEM LEARNING</Badge>
                          <CardTitle className="text-white text-xl">All Signals (Including Practice)</CardTitle>
                          <CardDescription className="text-slate-300 mt-1">
                            HIGH + MEDIUM tier for AI training • {dualGrowthStats.timeframe}
                          </CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const all = dualGrowthStats.allSignals.overall;
                          const comp = dualGrowthStats.comparison;

                          return (
                            <div className="space-y-6">
                              {/* Key Metrics */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Total Profit</p>
                                  <p className={`text-2xl font-bold ${all.totalProfitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {all.totalProfitPips >= 0 ? '+' : ''}{all.totalProfitPips.toFixed(1)} pips
                                  </p>
                                  {comp.profitDiff !== 0 && (
                                    <p className="text-xs text-slate-500 mt-1">
                                      ({comp.profitDiff >= 0 ? '+' : ''}{comp.profitDiff.toFixed(1)}p FXIFY diff)
                                    </p>
                                  )}
                                </div>
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Win Rate</p>
                                  <p className="text-2xl font-bold text-white">{all.winRate.toFixed(1)}%</p>
                                  {comp.winRateDiff !== 0 && (
                                    <p className="text-xs text-slate-500 mt-1">
                                      ({comp.winRateDiff >= 0 ? '+' : ''}{comp.winRateDiff.toFixed(1)}% FXIFY diff)
                                    </p>
                                  )}
                                </div>
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Total Signals</p>
                                  <p className="text-2xl font-bold text-white">{all.totalSignals}</p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    {all.wins}W / {all.losses}L
                                  </p>
                                </div>
                                <div className="bg-slate-900/30 p-4 rounded-lg">
                                  <p className="text-xs text-slate-400 mb-1">Profit Factor</p>
                                  <p className="text-2xl font-bold text-white">{all.profitFactor.toFixed(2)}</p>
                                </div>
                              </div>

                              {/* Comparison Insight */}
                              {comp.signalCountDiff > 0 && (
                                <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-500/30">
                                  <p className="font-semibold text-blue-300 mb-2">
                                    🧠 AI Learning Progress
                                  </p>
                                  <p className="text-sm text-slate-300">
                                    <span className="font-bold text-white">{comp.signalCountDiff}</span> paper trade signals (70-79% confidence) are being used to train the AI. These are NOT sent to FXIFY.
                                  </p>
                                  {comp.winRateDiff > 0 && (
                                    <p className="text-xs text-blue-400 mt-2">
                                      💡 FXIFY signals are {comp.winRateDiff.toFixed(1)}% more accurate
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Stats Summary */}
                              <div className="flex justify-between text-xs text-slate-400">
                                <div>
                                  <span className="text-slate-500">Avg Win:</span> +{all.avgWinPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-500">Avg Loss:</span> -{all.avgLossPips.toFixed(1)}p
                                </div>
                                <div>
                                  <span className="text-slate-500">Max DD:</span> -{all.maxDrawdown.toFixed(1)}p
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </CardContent>
                    </Card>

                    {/* All Signals Symbol Performance */}
                    <Card className="bg-slate-800/60 border-slate-600/50 shadow-xl">
                      <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2">
                          <BarChart3 className="w-5 h-5 text-slate-400" />
                          All Signals Symbol Performance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-slate-700">
                                <th className="text-left py-2 px-3 text-sm font-semibold text-slate-400">Symbol</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-400">Signals</th>
                                <th className="text-center py-2 px-3 text-sm font-semibold text-slate-400">Win Rate</th>
                                <th className="text-right py-2 px-3 text-sm font-semibold text-slate-400">Profit (pips)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dualGrowthStats.allSignals.symbolPerformance.map((symbol, idx) => {
                                const profitPips = parseFloat(symbol.profit_pips);
                                const winRate = parseFloat(symbol.win_rate);
                                return (
                                  <tr key={idx} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                                    <td className="py-2 px-3 font-semibold text-slate-300">{symbol.symbol}</td>
                                    <td className="py-2 px-3 text-center text-slate-400">{symbol.total_signals}</td>
                                    <td className="py-2 px-3 text-center">
                                      <span className={`font-semibold ${
                                        winRate >= 50 ? 'text-green-400' :
                                        winRate >= 35 ? 'text-yellow-400' :
                                        'text-red-400'
                                      }`}>
                                        {winRate.toFixed(1)}%
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right">
                                      <span className={`font-bold ${profitPips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {profitPips >= 0 ? '+' : ''}{profitPips.toFixed(1)}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </>
