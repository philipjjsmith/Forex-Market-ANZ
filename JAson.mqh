//+------------------------------------------------------------------+
//|                                                        JAson.mqh |
//|                                  JSON Parser/Serializer for MQL5 |
//|                             Based on vivazzi/JAson (MIT License) |
//+------------------------------------------------------------------+
#property copyright "Sergey N., 2016; vivazzi; ForexMarketANZ"
#property link      "https://github.com/vivazzi/JAson"
#property version   "1.20"
#property strict

//+------------------------------------------------------------------+
//| JSON Value Types                                                  |
//+------------------------------------------------------------------+
enum ENUM_JSON_TYPE
{
    JSON_NULL,
    JSON_BOOL,
    JSON_NUMBER,
    JSON_STRING,
    JSON_ARRAY,
    JSON_OBJECT
};

//+------------------------------------------------------------------+
//| CJAVal - Main JSON Value Class                                   |
//+------------------------------------------------------------------+
class CJAVal
{
private:
    ENUM_JSON_TYPE m_type;
    string m_str_val;
    double m_num_val;
    bool m_bool_val;

    // For objects and arrays
    CJAVal* m_items[];
    string m_keys[];
    int m_item_count;

public:
    // Constructor & Destructor
    CJAVal();
    CJAVal(ENUM_JSON_TYPE type);
    ~CJAVal();

    // Type accessors
    ENUM_JSON_TYPE Type() { return m_type; }
    void SetType(ENUM_JSON_TYPE type) { m_type = type; }

    // Value getters
    string ToStr();
    double ToDbl();
    int ToInt();
    bool ToBool();

    // Value setters
    void FromStr(string val);
    void FromDbl(double val);
    void FromInt(int val);
    void FromBool(bool val);

    // Array/Object operations
    int Size();
    void Clear();
    bool FindKey(string key);
    CJAVal* operator[](int index);
    CJAVal* operator[](string key);
    void Add(CJAVal* item);
    void AddPair(string key, CJAVal* item);

    // Serialization
    bool Deserialize(string json_str);
    string Serialize();

private:
    // Parsing helpers
    bool ParseValue(string &json, int &pos);
    bool ParseObject(string &json, int &pos);
    bool ParseArray(string &json, int &pos);
    bool ParseString(string &json, int &pos, string &result);
    bool ParseNumber(string &json, int &pos);
    bool ParseBool(string &json, int &pos);
    bool ParseNull(string &json, int &pos);

    void SkipWhitespace(string &json, int &pos);
    string EscapeString(string str);
    string UnescapeString(string str);
};

//+------------------------------------------------------------------+
//| Constructor                                                       |
//+------------------------------------------------------------------+
CJAVal::CJAVal()
{
    m_type = JSON_NULL;
    m_str_val = "";
    m_num_val = 0.0;
    m_bool_val = false;
    m_item_count = 0;
    ArrayResize(m_items, 0);
    ArrayResize(m_keys, 0);
}

//+------------------------------------------------------------------+
//| Constructor with type                                             |
//+------------------------------------------------------------------+
CJAVal::CJAVal(ENUM_JSON_TYPE type)
{
    m_type = type;
    m_str_val = "";
    m_num_val = 0.0;
    m_bool_val = false;
    m_item_count = 0;
    ArrayResize(m_items, 0);
    ArrayResize(m_keys, 0);
}

//+------------------------------------------------------------------+
//| Destructor                                                        |
//+------------------------------------------------------------------+
CJAVal::~CJAVal()
{
    Clear();
}

//+------------------------------------------------------------------+
//| Clear all items                                                   |
//+------------------------------------------------------------------+
void CJAVal::Clear()
{
    for(int i = 0; i < m_item_count; i++)
    {
        if(CheckPointer(m_items[i]) == POINTER_DYNAMIC)
            delete m_items[i];
    }

    ArrayResize(m_items, 0);
    ArrayResize(m_keys, 0);
    m_item_count = 0;
}

//+------------------------------------------------------------------+
//| Get string value                                                  |
//+------------------------------------------------------------------+
string CJAVal::ToStr()
{
    if(m_type == JSON_STRING)
        return m_str_val;
    else if(m_type == JSON_NUMBER)
        return DoubleToString(m_num_val, 8);
    else if(m_type == JSON_BOOL)
        return m_bool_val ? "true" : "false";
    else if(m_type == JSON_NULL)
        return "null";

    return "";
}

//+------------------------------------------------------------------+
//| Get double value                                                  |
//+------------------------------------------------------------------+
double CJAVal::ToDbl()
{
    if(m_type == JSON_NUMBER)
        return m_num_val;
    else if(m_type == JSON_STRING)
        return StringToDouble(m_str_val);
    else if(m_type == JSON_BOOL)
        return m_bool_val ? 1.0 : 0.0;

    return 0.0;
}

//+------------------------------------------------------------------+
//| Get int value                                                     |
//+------------------------------------------------------------------+
int CJAVal::ToInt()
{
    if(m_type == JSON_NUMBER)
        return (int)m_num_val;
    else if(m_type == JSON_STRING)
        return (int)StringToInteger(m_str_val);
    else if(m_type == JSON_BOOL)
        return m_bool_val ? 1 : 0;

    return 0;
}

//+------------------------------------------------------------------+
//| Get bool value                                                    |
//+------------------------------------------------------------------+
bool CJAVal::ToBool()
{
    if(m_type == JSON_BOOL)
        return m_bool_val;
    else if(m_type == JSON_NUMBER)
        return m_num_val != 0.0;
    else if(m_type == JSON_STRING)
        return m_str_val == "true" || m_str_val == "1";

    return false;
}

//+------------------------------------------------------------------+
//| Set string value                                                  |
//+------------------------------------------------------------------+
void CJAVal::FromStr(string val)
{
    m_type = JSON_STRING;
    m_str_val = val;
}

//+------------------------------------------------------------------+
//| Set double value                                                  |
//+------------------------------------------------------------------+
void CJAVal::FromDbl(double val)
{
    m_type = JSON_NUMBER;
    m_num_val = val;
}

//+------------------------------------------------------------------+
//| Set int value                                                     |
//+------------------------------------------------------------------+
void CJAVal::FromInt(int val)
{
    m_type = JSON_NUMBER;
    m_num_val = (double)val;
}

//+------------------------------------------------------------------+
//| Set bool value                                                    |
//+------------------------------------------------------------------+
void CJAVal::FromBool(bool val)
{
    m_type = JSON_BOOL;
    m_bool_val = val;
}

//+------------------------------------------------------------------+
//| Get size of array/object                                         |
//+------------------------------------------------------------------+
int CJAVal::Size()
{
    return m_item_count;
}

//+------------------------------------------------------------------+
//| Check if key exists in object                                    |
//+------------------------------------------------------------------+
bool CJAVal::FindKey(string key)
{
    if(m_type != JSON_OBJECT)
        return false;

    for(int i = 0; i < m_item_count; i++)
    {
        if(m_keys[i] == key)
            return true;
    }

    return false;
}

//+------------------------------------------------------------------+
//| Array index operator                                              |
//+------------------------------------------------------------------+
CJAVal* CJAVal::operator[](int index)
{
    if(m_type != JSON_ARRAY || index < 0 || index >= m_item_count)
        return GetPointer(this);  // Return self as fallback

    return m_items[index];
}

//+------------------------------------------------------------------+
//| Object key operator                                               |
//+------------------------------------------------------------------+
CJAVal* CJAVal::operator[](string key)
{
    if(m_type != JSON_OBJECT)
        return GetPointer(this);

    for(int i = 0; i < m_item_count; i++)
    {
        if(m_keys[i] == key)
            return m_items[i];
    }

    return GetPointer(this);  // Return self if key not found
}

//+------------------------------------------------------------------+
//| Add item to array                                                 |
//+------------------------------------------------------------------+
void CJAVal::Add(CJAVal* item)
{
    if(m_type != JSON_ARRAY)
    {
        m_type = JSON_ARRAY;
        Clear();
    }

    ArrayResize(m_items, m_item_count + 1);
    m_items[m_item_count] = item;
    m_item_count++;
}

//+------------------------------------------------------------------+
//| Add key-value pair to object                                     |
//+------------------------------------------------------------------+
void CJAVal::AddPair(string key, CJAVal* item)
{
    if(m_type != JSON_OBJECT)
    {
        m_type = JSON_OBJECT;
        Clear();
    }

    ArrayResize(m_items, m_item_count + 1);
    ArrayResize(m_keys, m_item_count + 1);
    m_keys[m_item_count] = key;
    m_items[m_item_count] = item;
    m_item_count++;
}

//+------------------------------------------------------------------+
//| Deserialize JSON string                                          |
//+------------------------------------------------------------------+
bool CJAVal::Deserialize(string json_str)
{
    Clear();

    int pos = 0;
    SkipWhitespace(json_str, pos);

    if(!ParseValue(json_str, pos))
        return false;

    return true;
}

//+------------------------------------------------------------------+
//| Serialize to JSON string                                         |
//+------------------------------------------------------------------+
string CJAVal::Serialize()
{
    string result = "";

    switch(m_type)
    {
        case JSON_NULL:
            result = "null";
            break;

        case JSON_BOOL:
            result = m_bool_val ? "true" : "false";
            break;

        case JSON_NUMBER:
            result = DoubleToString(m_num_val, 8);
            // Remove trailing zeros
            while(StringFind(result, ".") >= 0 && StringGetCharacter(result, StringLen(result) - 1) == '0')
                result = StringSubstr(result, 0, StringLen(result) - 1);
            if(StringGetCharacter(result, StringLen(result) - 1) == '.')
                result = StringSubstr(result, 0, StringLen(result) - 1);
            break;

        case JSON_STRING:
            result = "\"" + EscapeString(m_str_val) + "\"";
            break;

        case JSON_ARRAY:
            result = "[";
            for(int i = 0; i < m_item_count; i++)
            {
                if(i > 0)
                    result += ",";
                result += m_items[i].Serialize();
            }
            result += "]";
            break;

        case JSON_OBJECT:
            result = "{";
            for(int i = 0; i < m_item_count; i++)
            {
                if(i > 0)
                    result += ",";
                result += "\"" + EscapeString(m_keys[i]) + "\":" + m_items[i].Serialize();
            }
            result += "}";
            break;
    }

    return result;
}

//+------------------------------------------------------------------+
//| Parse any JSON value                                             |
//+------------------------------------------------------------------+
bool CJAVal::ParseValue(string &json, int &pos)
{
    SkipWhitespace(json, pos);

    if(pos >= StringLen(json))
        return false;

    ushort ch = StringGetCharacter(json, pos);

    if(ch == '{')
        return ParseObject(json, pos);
    else if(ch == '[')
        return ParseArray(json, pos);
    else if(ch == '"')
    {
        string str_result;
        if(!ParseString(json, pos, str_result))
            return false;
        FromStr(str_result);
        return true;
    }
    else if(ch == 't' || ch == 'f')
        return ParseBool(json, pos);
    else if(ch == 'n')
        return ParseNull(json, pos);
    else if((ch >= '0' && ch <= '9') || ch == '-')
        return ParseNumber(json, pos);

    return false;
}

//+------------------------------------------------------------------+
//| Parse JSON object                                                 |
//+------------------------------------------------------------------+
bool CJAVal::ParseObject(string &json, int &pos)
{
    m_type = JSON_OBJECT;

    pos++;  // Skip '{'
    SkipWhitespace(json, pos);

    if(StringGetCharacter(json, pos) == '}')
    {
        pos++;
        return true;  // Empty object
    }

    while(pos < StringLen(json))
    {
        SkipWhitespace(json, pos);

        // Parse key
        if(StringGetCharacter(json, pos) != '"')
            return false;

        string key;
        if(!ParseString(json, pos, key))
            return false;

        SkipWhitespace(json, pos);

        // Expect ':'
        if(StringGetCharacter(json, pos) != ':')
            return false;
        pos++;

        // Parse value
        CJAVal* value = new CJAVal();
        if(!value.ParseValue(json, pos))
        {
            delete value;
            return false;
        }

        AddPair(key, value);

        SkipWhitespace(json, pos);

        ushort ch = StringGetCharacter(json, pos);
        if(ch == '}')
        {
            pos++;
            return true;
        }
        else if(ch == ',')
        {
            pos++;
            continue;
        }
        else
            return false;
    }

    return false;
}

//+------------------------------------------------------------------+
//| Parse JSON array                                                  |
//+------------------------------------------------------------------+
bool CJAVal::ParseArray(string &json, int &pos)
{
    m_type = JSON_ARRAY;

    pos++;  // Skip '['
    SkipWhitespace(json, pos);

    if(StringGetCharacter(json, pos) == ']')
    {
        pos++;
        return true;  // Empty array
    }

    while(pos < StringLen(json))
    {
        CJAVal* value = new CJAVal();
        if(!value.ParseValue(json, pos))
        {
            delete value;
            return false;
        }

        Add(value);

        SkipWhitespace(json, pos);

        ushort ch = StringGetCharacter(json, pos);
        if(ch == ']')
        {
            pos++;
            return true;
        }
        else if(ch == ',')
        {
            pos++;
            continue;
        }
        else
            return false;
    }

    return false;
}

//+------------------------------------------------------------------+
//| Parse JSON string                                                 |
//+------------------------------------------------------------------+
bool CJAVal::ParseString(string &json, int &pos, string &result)
{
    pos++;  // Skip opening '"'

    result = "";

    while(pos < StringLen(json))
    {
        ushort ch = StringGetCharacter(json, pos);

        if(ch == '"')
        {
            pos++;
            result = UnescapeString(result);
            return true;
        }
        else if(ch == '\\')
        {
            pos++;
            if(pos >= StringLen(json))
                return false;

            result += StringSubstr(json, pos - 1, 2);
            pos++;
        }
        else
        {
            result += ShortToString(ch);
            pos++;
        }
    }

    return false;
}

//+------------------------------------------------------------------+
//| Parse JSON number                                                 |
//+------------------------------------------------------------------+
bool CJAVal::ParseNumber(string &json, int &pos)
{
    int start = pos;

    if(StringGetCharacter(json, pos) == '-')
        pos++;

    while(pos < StringLen(json))
    {
        ushort ch = StringGetCharacter(json, pos);
        if((ch >= '0' && ch <= '9') || ch == '.' || ch == 'e' || ch == 'E' || ch == '+' || ch == '-')
            pos++;
        else
            break;
    }

    string num_str = StringSubstr(json, start, pos - start);
    FromDbl(StringToDouble(num_str));

    return true;
}

//+------------------------------------------------------------------+
//| Parse JSON bool                                                   |
//+------------------------------------------------------------------+
bool CJAVal::ParseBool(string &json, int &pos)
{
    if(StringSubstr(json, pos, 4) == "true")
    {
        FromBool(true);
        pos += 4;
        return true;
    }
    else if(StringSubstr(json, pos, 5) == "false")
    {
        FromBool(false);
        pos += 5;
        return true;
    }

    return false;
}

//+------------------------------------------------------------------+
//| Parse JSON null                                                   |
//+------------------------------------------------------------------+
bool CJAVal::ParseNull(string &json, int &pos)
{
    if(StringSubstr(json, pos, 4) == "null")
    {
        m_type = JSON_NULL;
        pos += 4;
        return true;
    }

    return false;
}

//+------------------------------------------------------------------+
//| Skip whitespace characters                                        |
//+------------------------------------------------------------------+
void CJAVal::SkipWhitespace(string &json, int &pos)
{
    while(pos < StringLen(json))
    {
        ushort ch = StringGetCharacter(json, pos);
        if(ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n')
            pos++;
        else
            break;
    }
}

//+------------------------------------------------------------------+
//| Escape string for JSON                                           |
//+------------------------------------------------------------------+
string CJAVal::EscapeString(string str)
{
    string result = "";

    for(int i = 0; i < StringLen(str); i++)
    {
        ushort ch = StringGetCharacter(str, i);

        switch(ch)
        {
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '/':  result += "\\/";  break;
            case 8:    result += "\\b";  break;  // \b (backspace) - MQL5 doesn't support \b
            case 12:   result += "\\f";  break;  // \f (form feed) - MQL5 doesn't support \f
            case '\n': result += "\\n";  break;
            case '\r': result += "\\r";  break;
            case '\t': result += "\\t";  break;
            default:   result += ShortToString(ch); break;
        }
    }

    return result;
}

//+------------------------------------------------------------------+
//| Unescape JSON string                                             |
//+------------------------------------------------------------------+
string CJAVal::UnescapeString(string str)
{
    string result = "";

    for(int i = 0; i < StringLen(str); i++)
    {
        ushort ch = StringGetCharacter(str, i);

        if(ch == '\\' && i + 1 < StringLen(str))
        {
            i++;
            ushort next = StringGetCharacter(str, i);

            switch(next)
            {
                case '"':  result += "\""; break;
                case '\\': result += "\\"; break;
                case '/':  result += "/";  break;
                case 'b':  result += ShortToString(8);  break;  // \b (backspace)
                case 'f':  result += ShortToString(12); break;  // \f (form feed)
                case 'n':  result += "\n"; break;
                case 'r':  result += "\r"; break;
                case 't':  result += "\t"; break;
                default:   result += ShortToString(next); break;
            }
        }
        else
        {
            result += ShortToString(ch);
        }
    }

    return result;
}
