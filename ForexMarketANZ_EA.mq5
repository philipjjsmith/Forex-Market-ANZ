//+------------------------------------------------------------------+
//|                                          ForexMarketANZ_EA.mq5 |
//|                          Automated Trading System for FXIFY     |
//|                    ICT 3-Timeframe Strategy Executor v1.0.0     |
//+------------------------------------------------------------------+
#property copyright "ForexMarketANZ"
#property link      "https://forex-market-anz.pages.dev"
#property version   "1.00"
#property description "Automated executor for ICT 3-Timeframe trading signals"
#property description "Connects to ForexMarketANZ API and executes HIGH tier signals"
#property description "Designed for FXIFY prop firm trading with built-in risk management"

//--- Include JSON parsing library
#include <JAson.mqh>

//+------------------------------------------------------------------+
//| External Input Parameters (User-Configurable)                    |
//+------------------------------------------------------------------+
input group "=== API Configuration ==="
input string API_BASE_URL = "https://forex-market-anz.onrender.com";  // API Base URL
input string API_USERNAME = "";                                        // API Username (required)
input string API_PASSWORD = "";                                        // API Password (required)
input int POLL_INTERVAL_SECONDS = 60;                                 // Signal check interval (seconds)

input group "=== Trading Configuration ==="
input double ACCOUNT_BALANCE_OVERRIDE = 0.0;                          // Account balance override (0 = auto-detect)
input bool TRADE_ENABLED = true;                                      // Enable trade execution
input bool HIGH_TIER_ONLY = true;                                     // Execute HIGH tier signals only (85%+)
input double MIN_CONFIDENCE = 85.0;                                   // Minimum confidence threshold (%)

input group "=== Risk Management ==="
input double MAX_DAILY_LOSS_PERCENT = 3.5;                            // Daily loss limit (% of balance)
input double MAX_DRAWDOWN_PERCENT = 7.5;                              // Max drawdown limit (% of balance)
input int MAX_SLIPPAGE_POINTS = 30;                                   // Max acceptable slippage (points)
input int ORDER_RETRY_COUNT = 3;                                      // Order placement retry attempts
input int ORDER_RETRY_DELAY_MS = 2000;                                // Delay between retries (ms)

input group "=== Partial Profit Management ==="
input bool USE_PARTIAL_PROFITS = true;                                // Enable partial profit taking
input double PARTIAL_CLOSE_PERCENT_1 = 50.0;                          // Close % at TP1 (3.0x ATR)
input double PARTIAL_CLOSE_PERCENT_2 = 50.0;                          // Close % at TP3 (12.0x ATR)

input group "=== Logging & Diagnostics ==="
input bool VERBOSE_LOGGING = true;                                    // Enable detailed logging
input bool LOG_TO_FILE = true;                                        // Write logs to file
input int LOG_LEVEL = 2;                                              // Log level (0=Error, 1=Warning, 2=Info, 3=Debug)

//+------------------------------------------------------------------+
//| Global Variables                                                  |
//+------------------------------------------------------------------+
// Authentication
string g_jwtToken = "";
datetime g_tokenExpiry = 0;
bool g_authenticated = false;

// Trading state
double g_startingBalance = 0.0;
double g_dailyStartBalance = 0.0;
datetime g_lastDailyReset = 0;
double g_peakBalance = 0.0;

// Signal tracking
string g_processedSignalIDs[];  // Array of already-processed signal IDs
int g_signalCount = 0;

// Error tracking
int g_consecutiveAPIErrors = 0;
int g_consecutiveOrderErrors = 0;
datetime g_lastSuccessfulPoll = 0;

// Circuit breaker state
bool g_circuitBreakerTripped = false;
string g_circuitBreakerReason = "";

// File handle for logging
int g_logFileHandle = INVALID_HANDLE;

//+------------------------------------------------------------------+
//| Expert initialization function                                    |
//+------------------------------------------------------------------+
int OnInit()
{
    // Print startup banner
    Print("╔══════════════════════════════════════════════════════════════╗");
    Print("║          ForexMarketANZ EA v1.0.0 - Initializing           ║");
    Print("║       ICT 3-Timeframe Strategy Executor for FXIFY          ║");
    Print("╚══════════════════════════════════════════════════════════════╝");

    // Validate inputs
    if(!ValidateInputs())
    {
        Print("[ERROR] FATAL: Invalid input parameters - EA cannot start");
        return INIT_FAILED;
    }

    // Initialize logging system
    if(!InitializeLogging())
    {
        Print("[WARN]  WARNING: Logging initialization failed - continuing without file logging");
    }

    // Check WebRequest permissions
    if(!CheckWebRequestPermissions())
    {
        Print("[ERROR] FATAL: WebRequest permission not granted for API_BASE_URL");
        Print("   → Tools → Options → Expert Advisors → Allow WebRequest for listed URL");
        Print("   → Add: ", API_BASE_URL);
        return INIT_FAILED;
    }

    // Initialize account balance tracking
    InitializeBalanceTracking();

    // Authenticate with API
    LogInfo("Attempting API authentication...");
    if(!AuthenticateAPI())
    {
        Print("[ERROR] FATAL: API authentication failed - check username/password");
        return INIT_FAILED;
    }

    LogInfo("[OK] Authentication successful");

    // Set timer for periodic polling
    if(!EventSetTimer(POLL_INTERVAL_SECONDS))
    {
        Print("[ERROR] FATAL: Failed to set timer");
        return INIT_FAILED;
    }

    LogInfo(StringFormat("[TIMER]  Timer set: checking for signals every %d seconds", POLL_INTERVAL_SECONDS));

    // Load previously processed signals from GlobalVariables
    LoadProcessedSignals();

    // Initial signal check
    LogInfo("Performing initial signal check...");
    CheckForNewSignals();

    Print("[OK] ForexMarketANZ EA initialized successfully");
    Print(StringFormat("   Account: %d | Balance: $%.2f | Trade Mode: %s",
                       AccountInfoInteger(ACCOUNT_LOGIN),
                       AccountInfoDouble(ACCOUNT_BALANCE),
                       TRADE_ENABLED ? "LIVE" : "DISABLED"));

    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                  |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    // Kill timer
    EventKillTimer();

    // Save processed signals to GlobalVariables
    SaveProcessedSignals();

    // Close log file
    if(g_logFileHandle != INVALID_HANDLE)
    {
        FileClose(g_logFileHandle);
        g_logFileHandle = INVALID_HANDLE;
    }

    // Print shutdown reason
    string reasonText = GetDeinitReasonText(reason);
    Print("═══════════════════════════════════════════════════════════");
    Print("ForexMarketANZ EA stopped: ", reasonText);
    Print(StringFormat("Processed %d signals during this session", g_signalCount));
    Print("═══════════════════════════════════════════════════════════");
}

//+------------------------------------------------------------------+
//| Timer event handler (called every POLL_INTERVAL_SECONDS)         |
//+------------------------------------------------------------------+
void OnTimer()
{
    // Check if circuit breaker is tripped
    if(g_circuitBreakerTripped)
    {
        LogWarning(StringFormat("[WARN]  Circuit breaker active: %s - EA suspended", g_circuitBreakerReason));
        return;
    }

    // Reset daily stats at midnight UTC
    CheckDailyReset();

    // Check FXIFY risk limits before polling
    if(!CheckFXIFYLimits())
    {
        return;  // Limits exceeded - circuit breaker tripped
    }

    // Re-authenticate if token expired
    if(TimeCurrent() >= g_tokenExpiry)
    {
        LogInfo("[AUTH] Token expired - re-authenticating...");
        if(!AuthenticateAPI())
        {
            LogError("[ERROR] Re-authentication failed");
            g_consecutiveAPIErrors++;
            if(g_consecutiveAPIErrors >= 5)
            {
                TripCircuitBreaker("5 consecutive authentication failures");
            }
            return;
        }
        LogInfo("[OK] Re-authentication successful");
        g_consecutiveAPIErrors = 0;
    }

    // Check for new signals
    CheckForNewSignals();
}

//+------------------------------------------------------------------+
//| Input Validation                                                  |
//+------------------------------------------------------------------+
bool ValidateInputs()
{
    bool valid = true;

    // Check API credentials
    if(StringLen(API_USERNAME) == 0 || StringLen(API_PASSWORD) == 0)
    {
        Print("[ERROR] ERROR: API_USERNAME and API_PASSWORD are required");
        valid = false;
    }

    // Validate poll interval
    if(POLL_INTERVAL_SECONDS < 30)
    {
        Print("[ERROR] ERROR: POLL_INTERVAL_SECONDS must be >= 30 seconds");
        valid = false;
    }

    // Validate risk parameters
    if(MAX_DAILY_LOSS_PERCENT <= 0 || MAX_DAILY_LOSS_PERCENT > 10)
    {
        Print("[ERROR] ERROR: MAX_DAILY_LOSS_PERCENT must be between 0 and 10");
        valid = false;
    }

    if(MAX_DRAWDOWN_PERCENT <= 0 || MAX_DRAWDOWN_PERCENT > 20)
    {
        Print("[ERROR] ERROR: MAX_DRAWDOWN_PERCENT must be between 0 and 20");
        valid = false;
    }

    // Validate partial profit percentages
    if(USE_PARTIAL_PROFITS)
    {
        double totalPercent = PARTIAL_CLOSE_PERCENT_1 + PARTIAL_CLOSE_PERCENT_2;
        if(totalPercent != 100.0)
        {
            Print("[ERROR] ERROR: Partial profit percentages must sum to 100%");
            Print(StringFormat("   Current: %.1f%% + %.1f%% = %.1f%%",
                               PARTIAL_CLOSE_PERCENT_1, PARTIAL_CLOSE_PERCENT_2, totalPercent));
            valid = false;
        }
    }

    return valid;
}

//+------------------------------------------------------------------+
//| Initialize Logging System                                         |
//+------------------------------------------------------------------+
bool InitializeLogging()
{
    if(!LOG_TO_FILE)
        return true;

    // Create log directory if it doesn't exist
    string logDir = "ForexMarketANZ_Logs";
    if(!FolderCreate(logDir, FILE_COMMON))
    {
        // Folder might already exist - not an error
    }

    // Create log filename with date
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);
    string logFileName = StringFormat("%s\\EA_Log_%04d%02d%02d.log",
                                       logDir, dt.year, dt.mon, dt.day);

    // Open log file in append mode
    g_logFileHandle = FileOpen(logFileName, FILE_WRITE|FILE_READ|FILE_TXT|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE);

    if(g_logFileHandle == INVALID_HANDLE)
    {
        Print("[WARN]  Failed to open log file: ", GetLastError());
        return false;
    }

    // Seek to end of file for appending
    FileSeek(g_logFileHandle, 0, SEEK_END);

    // Write session start marker
    string startMarker = StringFormat("\n═══ EA SESSION START: %s ═══\n",
                                       TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS));
    FileWriteString(g_logFileHandle, startMarker);
    FileFlush(g_logFileHandle);

    return true;
}

//+------------------------------------------------------------------+
//| Check WebRequest Permissions                                      |
//+------------------------------------------------------------------+
bool CheckWebRequestPermissions()
{
    // Attempt a simple GET request to check permissions
    char post[], result[];
    string resultHeaders;

    int timeout = 5000;  // 5 second timeout for check

    // Just check if we can make a request - don't care about result
    int res = WebRequest("GET", API_BASE_URL + "/api/health", NULL, timeout, post, result, resultHeaders);

    // If we get any result (even error), permissions are OK
    // If we get -1 with error 4014, permissions are not set
    if(res == -1 && GetLastError() == 4014)  // ERR_FUNCTION_NOT_ALLOWED
    {
        return false;
    }

    return true;  // Permissions OK
}

//+------------------------------------------------------------------+
//| Initialize Balance Tracking                                       |
//+------------------------------------------------------------------+
void InitializeBalanceTracking()
{
    double currentBalance = ACCOUNT_BALANCE_OVERRIDE > 0 ? ACCOUNT_BALANCE_OVERRIDE : AccountInfoDouble(ACCOUNT_BALANCE);

    g_startingBalance = currentBalance;
    g_dailyStartBalance = currentBalance;
    g_peakBalance = currentBalance;
    g_lastDailyReset = TimeCurrent();

    LogInfo(StringFormat("[MONEY] Balance tracking initialized: $%.2f", currentBalance));
}

//+------------------------------------------------------------------+
//| Check Daily Reset (midnight UTC)                                 |
//+------------------------------------------------------------------+
void CheckDailyReset()
{
    MqlDateTime dtNow, dtLast;
    TimeToStruct(TimeCurrent(), dtNow);
    TimeToStruct(g_lastDailyReset, dtLast);

    // Check if we've crossed into a new day
    if(dtNow.day != dtLast.day || dtNow.mon != dtLast.mon || dtNow.year != dtLast.year)
    {
        LogInfo("[DAILY] Daily reset triggered - new trading day");

        double currentBalance = ACCOUNT_BALANCE_OVERRIDE > 0 ? ACCOUNT_BALANCE_OVERRIDE : AccountInfoDouble(ACCOUNT_BALANCE);
        g_dailyStartBalance = currentBalance;
        g_lastDailyReset = TimeCurrent();

        // Reset circuit breaker if it was a daily loss limit
        if(g_circuitBreakerTripped && StringFind(g_circuitBreakerReason, "Daily loss") >= 0)
        {
            LogInfo("[OK] Circuit breaker reset - new trading day");
            g_circuitBreakerTripped = false;
            g_circuitBreakerReason = "";
        }

        LogInfo(StringFormat("   New daily start balance: $%.2f", currentBalance));
    }
}

//+------------------------------------------------------------------+
//| Authenticate with API                                             |
//+------------------------------------------------------------------+
bool AuthenticateAPI()
{
    string url = API_BASE_URL + "/api/auth/login";

    // Prepare JSON request body (FIXED: using "email" instead of "username")
    string requestBody = StringFormat("{\"email\":\"%s\",\"password\":\"%s\"}",
                                       API_USERNAME, API_PASSWORD);

    // Convert to char array
    char postData[];
    StringToCharArray(requestBody, postData, 0, StringLen(requestBody));

    // Prepare headers
    string headers = "Content-Type: application/json\r\n";

    // Make request
    char resultData[];
    string resultHeaders;
    int timeout = 10000;  // 10 seconds

    ResetLastError();
    int res = WebRequest("POST", url, headers, timeout, postData, resultData, resultHeaders);

    if(res == -1)
    {
        int error = GetLastError();
        LogError(StringFormat("WebRequest failed: %d", error));
        return false;
    }

    if(res != 200)
    {
        LogError(StringFormat("Authentication failed with HTTP %d", res));
        string response = CharArrayToString(resultData);
        LogDebug(StringFormat("Response: %s", response));
        return false;
    }

    // Parse JSON response
    string response = CharArrayToString(resultData);
    LogDebug(StringFormat("Auth response: %s", response));

    // Parse using JAson library
    CJAVal json;
    if(!json.Deserialize(response))
    {
        LogError("Failed to parse authentication response JSON");
        return false;
    }

    // Extract token
    if(!json.FindKey("token"))
    {
        LogError("No token found in authentication response");
        return false;
    }

    g_jwtToken = json["token"].ToStr();

    // Set token expiry (24 hours from now - standard JWT)
    g_tokenExpiry = TimeCurrent() + (24 * 3600);
    g_authenticated = true;

    LogInfo("[AUTH] Authenticated successfully - token expires in 24h");

    return true;
}

//+------------------------------------------------------------------+
//| Check for New Signals from API                                   |
//+------------------------------------------------------------------+
void CheckForNewSignals()
{
    if(!g_authenticated)
    {
        LogWarning("Not authenticated - skipping signal check");
        return;
    }

    LogDebug("[POLLING] Polling API for new signals...");

    string url = API_BASE_URL + "/api/signals/active";

    // Prepare headers with JWT
    string headers = "Content-Type: application/json\r\n";
    headers += "Authorization: Bearer " + g_jwtToken + "\r\n";

    // Make GET request
    char postData[], resultData[];
    string resultHeaders;
    int timeout = 10000;

    ResetLastError();
    int res = WebRequest("GET", url, headers, timeout, postData, resultData, resultHeaders);

    if(res == -1)
    {
        int error = GetLastError();
        LogError(StringFormat("Signal fetch WebRequest failed: %d", error));
        g_consecutiveAPIErrors++;
        if(g_consecutiveAPIErrors >= 10)
        {
            TripCircuitBreaker("10 consecutive API errors");
        }
        return;
    }

    if(res == 401)
    {
        LogWarning("401 Unauthorized - token expired, will re-authenticate on next poll");
        g_tokenExpiry = 0;  // Force re-authentication
        return;
    }

    if(res != 200)
    {
        LogError(StringFormat("Signal fetch failed with HTTP %d", res));
        g_consecutiveAPIErrors++;
        return;
    }

    // Reset error counter on success
    g_consecutiveAPIErrors = 0;
    g_lastSuccessfulPoll = TimeCurrent();

    // Parse response
    string response = CharArrayToString(resultData);
    LogDebug(StringFormat("API response: %s", StringSubstr(response, 0, MathMin(200, StringLen(response))) + "..."));

    // Parse JSON object
    CJAVal json;
    if(!json.Deserialize(response))
    {
        LogError("Failed to parse signals JSON response");
        return;
    }

    // Extract signals array from response object
    if(!json.FindKey("signals"))
    {
        LogError("Response missing 'signals' key");
        return;
    }

    CJAVal signalsArray = json["signals"];
    int signalCount = signalsArray.Size();
    LogInfo(StringFormat("[API] Received %d active signal(s) from API", signalCount));

    if(signalCount == 0)
    {
        LogDebug("   No active signals at this time");
        return;
    }

    // Process each signal
    for(int i = 0; i < signalCount; i++)
    {
        CJAVal signal = signalsArray[i];
        ProcessSignal(signal);
    }
}

//+------------------------------------------------------------------+
//| Process Individual Signal                                         |
//+------------------------------------------------------------------+
void ProcessSignal(CJAVal &signal)
{
    // Extract signal ID
    if(!signal.FindKey("id"))
    {
        LogError("Signal missing 'id' field - skipping");
        return;
    }

    string signalID = IntegerToString(signal["id"].ToInt());

    // Check if already processed
    if(IsSignalProcessed(signalID))
    {
        LogDebug(StringFormat("Signal #%s already processed - skipping", signalID));
        return;
    }

    LogInfo(StringFormat("🔍 Processing new signal #%s", signalID));

    // Validate signal has all required fields
    if(!ValidateSignalStructure(signal))
    {
        LogError(StringFormat("Signal #%s failed validation - skipping", signalID));
        MarkSignalAsProcessed(signalID);  // Don't retry invalid signals
        return;
    }

    // Extract signal data
    string symbol = signal["symbol"].ToStr();
    string direction = signal["type"].ToStr();  // "LONG" or "SHORT"
    double entry = signal["entry"].ToDbl();
    double stop = signal["stop"].ToDbl();
    double tp1 = signal["tp1"].ToDbl();
    double tp3 = signal["tp3"].ToDbl();
    double confidence = signal["confidence"].ToDbl();
    string tier = signal["tier"].ToStr();
    bool tradeLive = signal["tradeLive"].ToBool();

    LogInfo(StringFormat("   Symbol: %s | Direction: %s | Entry: %.5f | Stop: %.5f",
                         symbol, direction, entry, stop));
    LogInfo(StringFormat("   TP1: %.5f | TP3: %.5f | Confidence: %.1f%% | Tier: %s",
                         tp1, tp3, confidence, tier));

    // Apply filters
    if(HIGH_TIER_ONLY && tier != "HIGH")
    {
        LogInfo(StringFormat("   [SKIP]  Skipping %s tier signal (HIGH_TIER_ONLY enabled)", tier));
        MarkSignalAsProcessed(signalID);
        return;
    }

    if(confidence < MIN_CONFIDENCE)
    {
        LogInfo(StringFormat("   [SKIP]  Skipping signal (confidence %.1f%% < threshold %.1f%%)",
                             confidence, MIN_CONFIDENCE));
        MarkSignalAsProcessed(signalID);
        return;
    }

    if(!tradeLive)
    {
        LogInfo("   [SKIP]  Skipping PRACTICE signal (tradeLive = false)");
        MarkSignalAsProcessed(signalID);
        return;
    }

    // Check weekend
    if(IsWeekend())
    {
        LogWarning("   [WEEKEND] Markets closed, will retry on next poll");
        return;  // Don't mark as processed - retry when markets open
    }

    // Check if symbol is tradable on this account
    if(!IsSymbolAvailable(symbol))
    {
        LogWarning(StringFormat("   [WARN]  Symbol %s not available on this account - skipping", symbol));
        MarkSignalAsProcessed(signalID);
        return;
    }

    // Execute signal if trading enabled
    if(!TRADE_ENABLED)
    {
        LogWarning("   [WARN]  TRADE_ENABLED = false - signal not executed (dry run mode)");
        MarkSignalAsProcessed(signalID);
        return;
    }

    // Execute the trade
    bool success = ExecuteSignal(signal, signalID);

    if(success)
    {
        LogInfo(StringFormat("   [OK] Signal #%s executed successfully", signalID));
        g_signalCount++;
        MarkSignalAsProcessed(signalID);
    }
    else
    {
        LogError(StringFormat("   [ERROR] Signal #%s execution failed", signalID));
        // Don't mark as processed - will retry on next poll
        g_consecutiveOrderErrors++;
        if(g_consecutiveOrderErrors >= 5)
        {
            TripCircuitBreaker("5 consecutive order execution failures");
        }
    }
}

//+------------------------------------------------------------------+
//| Validate Signal JSON Structure                                   |
//+------------------------------------------------------------------+
bool ValidateSignalStructure(CJAVal &signal)
{
    string requiredFields[] = {"id", "symbol", "type", "entry", "stop", "tp1", "tp3",
                                "confidence", "tier", "tradeLive", "positionSizePercent"};

    for(int i = 0; i < ArraySize(requiredFields); i++)
    {
        if(!signal.FindKey(requiredFields[i]))
        {
            LogError(StringFormat("Signal missing required field: %s", requiredFields[i]));
            return false;
        }
    }

    return true;
}

//+------------------------------------------------------------------+
//| Execute Trading Signal                                            |
//+------------------------------------------------------------------+
bool ExecuteSignal(CJAVal &signal, string signalID)
{
    string symbol = signal["symbol"].ToStr();
    string direction = signal["type"].ToStr();
    double entry = signal["entry"].ToDbl();
    double stop = signal["stop"].ToDbl();
    double tp1 = signal["tp1"].ToDbl();
    double tp3 = signal["tp3"].ToDbl();
    double positionSizePercent = signal["positionSizePercent"].ToDbl();

    // Normalize symbol format (e.g., "EUR/USD" -> "EURUSD")
    string mtSymbol = NormalizeSymbolName(symbol);

    // Select symbol and refresh rates
    if(!SymbolSelect(mtSymbol, true))
    {
        LogError(StringFormat("Failed to select symbol %s", mtSymbol));
        return false;
    }

    // Refresh market data
    MqlTick lastTick;
    if(!SymbolInfoTick(mtSymbol, lastTick))
    {
        LogError(StringFormat("Failed to get tick data for %s", mtSymbol));
        return false;
    }

    // Calculate lot sizes
    double accountBalance = ACCOUNT_BALANCE_OVERRIDE > 0 ? ACCOUNT_BALANCE_OVERRIDE : AccountInfoDouble(ACCOUNT_BALANCE);
    double riskAmount = accountBalance * (positionSizePercent / 100.0);
    double stopDistance = MathAbs(entry - stop);

    // Calculate base lot size
    double lotSize = CalculateLotSize(mtSymbol, riskAmount, stopDistance);

    if(lotSize <= 0)
    {
        LogError("Calculated lot size is 0 or negative");
        return false;
    }

    LogInfo(StringFormat("   [MONEY] Position sizing: Risk=$%.2f (%.2f%%) | Lots=%.2f",
                         riskAmount, positionSizePercent, lotSize));

    // Determine order type
    ENUM_ORDER_TYPE orderType;
    if(direction == "LONG")
        orderType = ORDER_TYPE_BUY;
    else if(direction == "SHORT")
        orderType = ORDER_TYPE_SELL;
    else
    {
        LogError(StringFormat("Invalid signal direction: %s", direction));
        return false;
    }

    // Execute partial profit strategy
    if(USE_PARTIAL_PROFITS && PARTIAL_CLOSE_PERCENT_1 > 0 && PARTIAL_CLOSE_PERCENT_2 > 0)
    {
        // Place two orders for partial profits
        double lot1 = NormalizeLot(mtSymbol, lotSize * (PARTIAL_CLOSE_PERCENT_1 / 100.0));
        double lot2 = NormalizeLot(mtSymbol, lotSize * (PARTIAL_CLOSE_PERCENT_2 / 100.0));

        LogInfo(StringFormat("   📈 Partial profit mode: Order 1 = %.2f lots @ TP1, Order 2 = %.2f lots @ TP3",
                             lot1, lot2));

        // Place order 1 (TP1 target)
        string comment1 = StringFormat("Signal#%s-TP1", signalID);
        ulong ticket1 = PlaceMarketOrder(mtSymbol, orderType, lot1, stop, tp1, comment1);

        if(ticket1 == 0)
        {
            LogError("   [ERROR] Failed to place Order 1 (TP1)");
            return false;
        }

        LogInfo(StringFormat("   [OK] Order 1 placed: Ticket #%llu (%.2f lots @ TP1=%.5f)", ticket1, lot1, tp1));

        // Place order 2 (TP3 target)
        string comment2 = StringFormat("Signal#%s-TP3", signalID);
        ulong ticket2 = PlaceMarketOrder(mtSymbol, orderType, lot2, stop, tp3, comment2);

        if(ticket2 == 0)
        {
            LogWarning("   [WARN]  Failed to place Order 2 (TP3) - Order 1 already placed");
            return true;  // Consider partial success
        }

        LogInfo(StringFormat("   [OK] Order 2 placed: Ticket #%llu (%.2f lots @ TP3=%.5f)", ticket2, lot2, tp3));

        return true;
    }
    else
    {
        // Single order (no partial profits)
        string comment = StringFormat("Signal#%s", signalID);
        ulong ticket = PlaceMarketOrder(mtSymbol, orderType, lotSize, stop, tp1, comment);

        if(ticket == 0)
        {
            LogError("   [ERROR] Failed to place order");
            return false;
        }

        LogInfo(StringFormat("   [OK] Order placed: Ticket #%llu (%.2f lots @ TP=%.5f)", ticket, lotSize, tp1));

        return true;
    }
}

//+------------------------------------------------------------------+
//| Place Market Order with Retry Logic                              |
//+------------------------------------------------------------------+
ulong PlaceMarketOrder(string symbol, ENUM_ORDER_TYPE orderType, double lots, double stopLoss, double takeProfit, string comment)
{
    MqlTradeRequest request = {};
    MqlTradeResult result = {};

    // Prepare request
    request.action = TRADE_ACTION_DEAL;
    request.symbol = symbol;
    request.volume = lots;
    request.type = orderType;
    request.deviation = MAX_SLIPPAGE_POINTS;
    request.magic = 240226;  // Magic number for identification
    request.comment = comment;

    // Set price based on order type
    if(orderType == ORDER_TYPE_BUY)
        request.price = SymbolInfoDouble(symbol, SYMBOL_ASK);
    else
        request.price = SymbolInfoDouble(symbol, SYMBOL_BID);

    // Normalize and set SL/TP
    int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
    request.sl = NormalizeDouble(stopLoss, digits);
    request.tp = NormalizeDouble(takeProfit, digits);

    // Retry loop
    for(int attempt = 1; attempt <= ORDER_RETRY_COUNT; attempt++)
    {
        ResetLastError();

        bool sent = OrderSend(request, result);

        if(sent && result.retcode == TRADE_RETCODE_DONE)
        {
            LogInfo(StringFormat("      Order placed successfully on attempt %d (ticket #%llu)", attempt, result.order));
            g_consecutiveOrderErrors = 0;  // Reset error counter
            return result.order;
        }
        else
        {
            int error = GetLastError();
            LogWarning(StringFormat("      Order attempt %d failed: retcode=%d, error=%d (%s)",
                                     attempt, result.retcode, error, GetRetcodeDescription(result.retcode)));

            // If requote or price changed, refresh and retry
            if(result.retcode == TRADE_RETCODE_REQUOTE || result.retcode == TRADE_RETCODE_PRICE_CHANGED)
            {
                if(attempt < ORDER_RETRY_COUNT)
                {
                    Sleep(ORDER_RETRY_DELAY_MS);

                    // Refresh price
                    if(orderType == ORDER_TYPE_BUY)
                        request.price = SymbolInfoDouble(symbol, SYMBOL_ASK);
                    else
                        request.price = SymbolInfoDouble(symbol, SYMBOL_BID);

                    LogDebug(StringFormat("      Retrying with new price: %.5f", request.price));
                    continue;
                }
            }

            // If insufficient margin, don't retry
            if(result.retcode == TRADE_RETCODE_NO_MONEY)
            {
                LogError("      FATAL: Insufficient margin - stopping retries");
                break;
            }

            // If other error, wait and retry
            if(attempt < ORDER_RETRY_COUNT)
            {
                Sleep(ORDER_RETRY_DELAY_MS);
            }
        }
    }

    LogError(StringFormat("      Order placement failed after %d attempts", ORDER_RETRY_COUNT));
    return 0;  // Failed
}

//+------------------------------------------------------------------+
//| Calculate Lot Size Based on Risk                                 |
//+------------------------------------------------------------------+
double CalculateLotSize(string symbol, double riskAmount, double stopDistancePrice)
{
    // Get symbol specifications
    double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
    double tickSize = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
    double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
    double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
    double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

    if(tickValue == 0 || tickSize == 0)
    {
        LogError("Invalid tick value or tick size for " + symbol);
        return 0;
    }

    // Calculate pip value per lot
    double pipValue = tickValue / tickSize;

    // Calculate stop distance in pips
    double stopDistancePips = stopDistancePrice / tickSize;

    // Calculate lot size
    double lotSize = riskAmount / (stopDistancePips * pipValue);

    // Normalize to lot step
    lotSize = NormalizeLot(symbol, lotSize);

    // Enforce limits
    if(lotSize < minLot)
    {
        LogWarning(StringFormat("Calculated lot size %.4f < minimum %.4f - using minimum", lotSize, minLot));
        lotSize = minLot;
    }

    if(lotSize > maxLot)
    {
        LogWarning(StringFormat("Calculated lot size %.4f > maximum %.4f - using maximum", lotSize, maxLot));
        lotSize = maxLot;
    }

    return lotSize;
}

//+------------------------------------------------------------------+
//| Normalize Lot Size to Symbol's Lot Step                         |
//+------------------------------------------------------------------+
double NormalizeLot(string symbol, double lots)
{
    double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

    if(lotStep == 0)
        return lots;

    return MathFloor(lots / lotStep) * lotStep;
}

//+------------------------------------------------------------------+
//| Check FXIFY Risk Limits                                          |
//+------------------------------------------------------------------+
bool CheckFXIFYLimits()
{
    double currentBalance = ACCOUNT_BALANCE_OVERRIDE > 0 ? ACCOUNT_BALANCE_OVERRIDE : AccountInfoDouble(ACCOUNT_BALANCE);
    double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);

    // Update peak balance
    if(currentBalance > g_peakBalance)
        g_peakBalance = currentBalance;

    // Check daily loss limit
    double dailyPL = currentBalance - g_dailyStartBalance;
    double dailyLossPercent = (dailyPL / g_dailyStartBalance) * 100.0;

    if(dailyLossPercent <= -MAX_DAILY_LOSS_PERCENT)
    {
        TripCircuitBreaker(StringFormat("Daily loss limit reached: %.2f%% (limit: %.2f%%)",
                                         MathAbs(dailyLossPercent), MAX_DAILY_LOSS_PERCENT));
        return false;
    }

    // Check max drawdown from peak
    double drawdown = g_peakBalance - currentEquity;
    double drawdownPercent = (drawdown / g_peakBalance) * 100.0;

    if(drawdownPercent >= MAX_DRAWDOWN_PERCENT)
    {
        TripCircuitBreaker(StringFormat("Max drawdown limit reached: %.2f%% (limit: %.2f%%)",
                                         drawdownPercent, MAX_DRAWDOWN_PERCENT));
        return false;
    }

    // Log status periodically
    if(VERBOSE_LOGGING)
    {
        LogDebug(StringFormat("[MONEY] Account Status: Balance=$%.2f | Equity=$%.2f | Daily P/L=%.2f%% | Drawdown=%.2f%%",
                              currentBalance, currentEquity, dailyLossPercent, drawdownPercent));
    }

    return true;
}

//+------------------------------------------------------------------+
//| Trip Circuit Breaker                                              |
//+------------------------------------------------------------------+
void TripCircuitBreaker(string reason)
{
    g_circuitBreakerTripped = true;
    g_circuitBreakerReason = reason;

    LogError("[ALERT] CIRCUIT BREAKER TRIPPED");
    LogError("   Reason: " + reason);
    LogError("   EA trading suspended - manual intervention required");

    // Send notification (if email/push configured)
    SendNotification("ForexMarketANZ EA: Circuit Breaker Tripped - " + reason);
}

//+------------------------------------------------------------------+
//| Check if Weekend                                                  |
//+------------------------------------------------------------------+
bool IsWeekend()
{
    MqlDateTime dt;
    TimeToStruct(TimeCurrent(), dt);

    // Saturday = 6, Sunday = 0
    return (dt.day_of_week == 0 || dt.day_of_week == 6);
}

//+------------------------------------------------------------------+
//| Check if Symbol Available                                        |
//+------------------------------------------------------------------+
bool IsSymbolAvailable(string symbol)
{
    string mtSymbol = NormalizeSymbolName(symbol);

    // Try to select symbol
    if(!SymbolSelect(mtSymbol, true))
        return false;

    // Check if symbol exists in Market Watch
    return (bool)SymbolInfoInteger(mtSymbol, SYMBOL_SELECT);
}

//+------------------------------------------------------------------+
//| Normalize Symbol Name (e.g., EUR/USD -> EURUSD)                 |
//+------------------------------------------------------------------+
string NormalizeSymbolName(string symbol)
{
    string normalized = symbol;
    StringReplace(normalized, "/", "");  // Remove slashes
    StringReplace(normalized, " ", "");  // Remove spaces

    return normalized;
}

//+------------------------------------------------------------------+
//| Check if Signal Already Processed                                |
//+------------------------------------------------------------------+
bool IsSignalProcessed(string signalID)
{
    // Check in-memory array first
    for(int i = 0; i < ArraySize(g_processedSignalIDs); i++)
    {
        if(g_processedSignalIDs[i] == signalID)
            return true;
    }

    // Check GlobalVariable (persists across EA restarts)
    string varName = "FMA_Signal_" + signalID;
    if(GlobalVariableCheck(varName))
        return true;

    return false;
}

//+------------------------------------------------------------------+
//| Mark Signal as Processed                                         |
//+------------------------------------------------------------------+
void MarkSignalAsProcessed(string signalID)
{
    // Add to in-memory array
    int size = ArraySize(g_processedSignalIDs);
    ArrayResize(g_processedSignalIDs, size + 1);
    g_processedSignalIDs[size] = signalID;

    // Save to GlobalVariable (persists 4 weeks by default)
    string varName = "FMA_Signal_" + signalID;
    GlobalVariableSet(varName, TimeCurrent());

    LogDebug(StringFormat("Signal #%s marked as processed", signalID));
}

//+------------------------------------------------------------------+
//| Load Processed Signals from GlobalVariables                      |
//+------------------------------------------------------------------+
void LoadProcessedSignals()
{
    int total = GlobalVariablesTotal();
    int loaded = 0;

    for(int i = 0; i < total; i++)
    {
        string varName = GlobalVariableName(i);

        // Check if this is one of our signal tracking variables
        if(StringFind(varName, "FMA_Signal_") == 0)
        {
            // Extract signal ID
            string signalID = StringSubstr(varName, StringLen("FMA_Signal_"));

            // Add to array
            int size = ArraySize(g_processedSignalIDs);
            ArrayResize(g_processedSignalIDs, size + 1);
            g_processedSignalIDs[size] = signalID;

            loaded++;
        }
    }

    if(loaded > 0)
        LogInfo(StringFormat("[MEMORY] Loaded %d previously processed signal(s) from memory", loaded));
}

//+------------------------------------------------------------------+
//| Save Processed Signals to GlobalVariables                        |
//+------------------------------------------------------------------+
void SaveProcessedSignals()
{
    // GlobalVariables are automatically persisted
    // This function exists for future enhancement (e.g., cleanup old signals)

    LogInfo(StringFormat("[SAVE] Processed signals saved (%d total)", ArraySize(g_processedSignalIDs)));
}

//+------------------------------------------------------------------+
//| Logging Functions                                                 |
//+------------------------------------------------------------------+
void LogError(string message)
{
    if(LOG_LEVEL >= 0)
    {
        string logMsg = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + " [ERROR] " + message;
        Print(logMsg);
        WriteToLogFile(logMsg);
    }
}

void LogWarning(string message)
{
    if(LOG_LEVEL >= 1)
    {
        string logMsg = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + " [WARN]  " + message;
        Print(logMsg);
        WriteToLogFile(logMsg);
    }
}

void LogInfo(string message)
{
    if(LOG_LEVEL >= 2)
    {
        string logMsg = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + " [INFO]  " + message;
        Print(logMsg);
        WriteToLogFile(logMsg);
    }
}

void LogDebug(string message)
{
    if(LOG_LEVEL >= 3)
    {
        string logMsg = TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS) + " [DEBUG] " + message;
        Print(logMsg);
        WriteToLogFile(logMsg);
    }
}

void WriteToLogFile(string message)
{
    if(!LOG_TO_FILE || g_logFileHandle == INVALID_HANDLE)
        return;

    FileWriteString(g_logFileHandle, message + "\n");
    FileFlush(g_logFileHandle);
}

//+------------------------------------------------------------------+
//| Helper: Get Deinit Reason Text                                   |
//+------------------------------------------------------------------+
string GetDeinitReasonText(int reason)
{
    switch(reason)
    {
        case REASON_PROGRAM:     return "EA stopped by user";
        case REASON_REMOVE:      return "EA removed from chart";
        case REASON_RECOMPILE:   return "EA recompiled";
        case REASON_CHARTCHANGE: return "Chart symbol or period changed";
        case REASON_CHARTCLOSE:  return "Chart closed";
        case REASON_PARAMETERS:  return "Input parameters changed";
        case REASON_ACCOUNT:     return "Account changed";
        case REASON_TEMPLATE:    return "Template applied";
        case REASON_INITFAILED:  return "Initialization failed";
        case REASON_CLOSE:       return "Terminal closed";
        default:                 return "Unknown reason";
    }
}

//+------------------------------------------------------------------+
//| Helper: Get Trade Return Code Description                        |
//+------------------------------------------------------------------+
string GetRetcodeDescription(int retcode)
{
    switch(retcode)
    {
        case TRADE_RETCODE_DONE:           return "Request completed";
        case TRADE_RETCODE_REQUOTE:        return "Requote";
        case TRADE_RETCODE_REJECT:         return "Request rejected";
        case TRADE_RETCODE_CANCEL:         return "Request canceled";
        case TRADE_RETCODE_PLACED:         return "Order placed";
        case TRADE_RETCODE_DONE_PARTIAL:   return "Partial fill";
        case TRADE_RETCODE_ERROR:          return "Request error";
        case TRADE_RETCODE_TIMEOUT:        return "Timeout";
        case TRADE_RETCODE_INVALID:        return "Invalid request";
        case TRADE_RETCODE_INVALID_VOLUME: return "Invalid volume";
        case TRADE_RETCODE_INVALID_PRICE:  return "Invalid price";
        case TRADE_RETCODE_INVALID_STOPS:  return "Invalid stops";
        case TRADE_RETCODE_TRADE_DISABLED: return "Trading disabled";
        case TRADE_RETCODE_MARKET_CLOSED:  return "Market closed";
        case TRADE_RETCODE_NO_MONEY:       return "Insufficient funds";
        case TRADE_RETCODE_PRICE_CHANGED:  return "Price changed";
        case TRADE_RETCODE_PRICE_OFF:      return "No quotes";
        case TRADE_RETCODE_INVALID_EXPIRATION: return "Invalid expiration";
        case TRADE_RETCODE_ORDER_CHANGED:  return "Order changed";
        case TRADE_RETCODE_TOO_MANY_REQUESTS: return "Too many requests";
        case TRADE_RETCODE_NO_CHANGES:     return "No changes";
        case TRADE_RETCODE_SERVER_DISABLES_AT: return "Autotrading disabled by server";
        case TRADE_RETCODE_CLIENT_DISABLES_AT: return "Autotrading disabled by client";
        case TRADE_RETCODE_LOCKED:         return "Request locked";
        case TRADE_RETCODE_FROZEN:         return "Order/position frozen";
        case TRADE_RETCODE_INVALID_FILL:   return "Invalid fill type";
        case TRADE_RETCODE_CONNECTION:     return "No connection";
        case TRADE_RETCODE_ONLY_REAL:      return "Only real accounts allowed";
        case TRADE_RETCODE_LIMIT_ORDERS:   return "Orders limit reached";
        case TRADE_RETCODE_LIMIT_VOLUME:   return "Volume limit reached";
        default:                           return "Unknown return code";
    }
}
