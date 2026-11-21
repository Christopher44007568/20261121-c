#pragma once
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <stdexcept>

namespace lmuv {

class Json {
public:
  enum class Type { Null, Bool, Number, String, Array, Object };
  Type type = Type::Null;
  bool b = false;
  double num = 0.0;
  std::string str;
  std::vector<Json> arr;
  std::vector<std::pair<std::string, Json>> obj;

  Json() = default;
  static Json makeObject() { Json j; j.type = Type::Object; return j; }
  static Json makeArray() { Json j; j.type = Type::Array; return j; }

  bool isObject() const { return type == Type::Object; }
  bool has(const std::string& key) const;
  const Json& get(const std::string& key) const;
  double getNumber(const std::string& key, double def = 0.0) const;
  int getInt(const std::string& key, int def = 0) const;
  bool getBool(const std::string& key, bool def = false) const;
  std::string getString(const std::string& key, const std::string& def = "") const;
  void set(const std::string& key, Json value);

  std::string dump(int indent = 2) const;
  static Json parse(const std::string& text);
};

struct JsonError : std::runtime_error {
  explicit JsonError(const std::string& m) : std::runtime_error(m) {}
};

} // namespace lmuv
