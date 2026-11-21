#include "lmuv/json.h"
#include <sstream>
#include <cctype>
#include <cmath>

namespace lmuv {

bool Json::has(const std::string& key) const {
  if (type != Type::Object) return false;
  for (const auto& kv : obj) if (kv.first == key) return true;
  return false;
}

const Json& Json::get(const std::string& key) const {
  for (const auto& kv : obj)
    if (kv.first == key) return kv.second;
  throw JsonError("missing key: " + key);
}

double Json::getNumber(const std::string& key, double def) const {
  return has(key) ? get(key).num : def;
}
int Json::getInt(const std::string& key, int def) const {
  return has(key) ? static_cast<int>(get(key).num) : def;
}
bool Json::getBool(const std::string& key, bool def) const {
  return has(key) ? get(key).b : def;
}
std::string Json::getString(const std::string& key, const std::string& def) const {
  return has(key) ? get(key).str : def;
}

void Json::set(const std::string& key, Json value) {
  if (type != Type::Object) { type = Type::Object; }
  for (auto& kv : obj) {
    if (kv.first == key) { kv.second = std::move(value); return; }
  }
  obj.emplace_back(key, std::move(value));
}

namespace {

std::string escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 2);
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\t': out += "\\t"; break;
      case '\r': out += "\\r"; break;
      default: out += c;
    }
  }
  return out;
}

void dumpTo(const Json& j, std::string& out, int indent, int depth) {
  auto pad = [&](int d) { if (indent > 0) out.append(d * indent, ' '); };
  switch (j.type) {
    case Json::Type::Null: out += "null"; break;
    case Json::Type::Bool: out += j.b ? "true" : "false"; break;
    case Json::Type::Number: {
      std::ostringstream ss;
      ss << j.num;
      std::string s = ss.str();
      if (s.find('.') == std::string::npos && s.find('e') == std::string::npos &&
          s.find('n') == std::string::npos && s.find('i') == std::string::npos)
        s += ".0";
      out += s;
      break;
    }
    case Json::Type::String: out += '"' + escape(j.str) + '"'; break;
    case Json::Type::Array: {
      if (j.arr.empty()) { out += "[]"; break; }
      out += '[';
      if (indent > 0) out += '\n';
      for (size_t i = 0; i < j.arr.size(); ++i) {
        pad(depth + 1);
        dumpTo(j.arr[i], out, indent, depth + 1);
        if (i + 1 < j.arr.size()) out += ',';
        if (indent > 0) out += '\n';
      }
      pad(depth);
      out += ']';
      break;
    }
    case Json::Type::Object: {
      if (j.obj.empty()) { out += "{}"; break; }
      out += '{';
      if (indent > 0) out += '\n';
      for (size_t i = 0; i < j.obj.size(); ++i) {
        pad(depth + 1);
        out += '"' + escape(j.obj[i].first) + "\":";
        if (indent > 0) out += ' ';
        dumpTo(j.obj[i].second, out, indent, depth + 1);
        if (i + 1 < j.obj.size()) out += ',';
        if (indent > 0) out += '\n';
      }
      pad(depth);
      out += '}';
      break;
    }
  }
}

class Parser {
public:
  explicit Parser(const std::string& t) : text(t) {}
  Json parse() {
    skipWs();
    Json v = parseValue();
    skipWs();
    if (pos != text.size()) throw JsonError("trailing characters");
    return v;
  }

private:
  const std::string& text;
  size_t pos = 0;

  void skipWs() {
    while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) ++pos;
  }
  char peek() {
    if (pos >= text.size()) throw JsonError("unexpected end");
    return text[pos];
  }
  Json parseValue() {
    skipWs();
    char c = peek();
    if (c == '{') return parseObject();
    if (c == '[') return parseArray();
    if (c == '"') { Json j; j.type = Json::Type::String; j.str = parseString(); return j; }
    if (c == 't' || c == 'f') return parseBool();
    if (c == 'n') return parseNull();
    return parseNumber();
  }
  Json parseObject() {
    Json j = Json::makeObject();
    ++pos;
    skipWs();
    if (peek() == '}') { ++pos; return j; }
    while (true) {
      skipWs();
      if (peek() != '"') throw JsonError("expected string key");
      std::string key = parseString();
      skipWs();
      if (peek() != ':') throw JsonError("expected ':'");
      ++pos;
      j.set(key, parseValue());
      skipWs();
      char c = peek();
      ++pos;
      if (c == ',') continue;
      if (c == '}') break;
      throw JsonError("expected ',' or '}'");
    }
    return j;
  }
  Json parseArray() {
    Json j = Json::makeArray();
    ++pos;
    skipWs();
    if (peek() == ']') { ++pos; return j; }
    while (true) {
      j.arr.push_back(parseValue());
      skipWs();
      char c = peek();
      ++pos;
      if (c == ',') continue;
      if (c == ']') break;
      throw JsonError("expected ',' or ']'");
    }
    return j;
  }
  std::string parseString() {
    ++pos;
    std::string out;
    while (true) {
      if (pos >= text.size()) throw JsonError("unterminated string");
      char c = text[pos++];
      if (c == '"') break;
      if (c == '\\') {
        if (pos >= text.size()) throw JsonError("bad escape");
        char e = text[pos++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          default: out += e;
        }
      } else {
        out += c;
      }
    }
    return out;
  }
  Json parseBool() {
    if (text.compare(pos, 4, "true") == 0) { pos += 4; Json j; j.type = Json::Type::Bool; j.b = true; return j; }
    if (text.compare(pos, 5, "false") == 0) { pos += 5; Json j; j.type = Json::Type::Bool; j.b = false; return j; }
    throw JsonError("bad literal");
  }
  Json parseNull() {
    if (text.compare(pos, 4, "null") == 0) { pos += 4; return Json{}; }
    throw JsonError("bad literal");
  }
  Json parseNumber() {
    size_t start = pos;
    if (peek() == '-' || peek() == '+') ++pos;
    while (pos < text.size() &&
           (std::isdigit(static_cast<unsigned char>(text[pos])) ||
            text[pos] == '.' || text[pos] == 'e' || text[pos] == 'E' ||
            text[pos] == '+' || text[pos] == '-'))
      ++pos;
    std::string s = text.substr(start, pos - start);
    Json j;
    try {
      j.num = std::stod(s);
    } catch (...) {
      throw JsonError("bad number: " + s);
    }
    j.type = Json::Type::Number;
    return j;
  }
};

} // namespace

std::string Json::dump(int indent) const {
  std::string out;
  dumpTo(*this, out, indent, 0);
  return out;
}

Json Json::parse(const std::string& text) {
  return Parser(text).parse();
}
} // namespace lmuv
