import ApplicationServices
import Foundation

let spreadsheetRoles: Set<String> = [
  "AXTable", "AXGrid", "AXCell", "AXRow", "AXColumn", "AXOutline",
]

let textRoles: Set<String> = [
  "AXTextArea", "AXTextField", "AXComboBox", "AXSearchField",
]

func roleOf(_ element: AXUIElement) -> String? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value)
  guard err == .success, let role = value as? String else { return nil }
  return role
}

func parentOf(_ element: AXUIElement) -> AXUIElement? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &value)
  guard err == .success, let parent = value else { return nil }
  return (parent as! AXUIElement)
}

func subroleOf(_ element: AXUIElement) -> String? {
  var value: CFTypeRef?
  let err = AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &value)
  guard err == .success, let subrole = value as? String, !subrole.isEmpty else { return nil }
  return subrole
}

func collectRoles(from element: AXUIElement, maxDepth: Int = 12) -> [String] {
  var roles: [String] = []
  var current: AXUIElement? = element
  var depth = 0
  while let el = current, depth < maxDepth {
    if let role = roleOf(el) {
      roles.append(role)
    }
    if let subrole = subroleOf(el) {
      roles.append(subrole)
    }
    current = parentOf(el)
    depth += 1
  }
  return roles
}

var focused: CFTypeRef?
let err = AXUIElementCopyAttributeValue(
  AXUIElementCreateSystemWide(),
  kAXFocusedUIElementAttribute as CFString,
  &focused
)

var payload: [String: Any] = [
  "ok": false,
  "roles": [] as [String],
  "spreadsheetLike": false,
  "textLike": false,
]

if err == .success, let element = focused {
  let roles = collectRoles(from: element as! AXUIElement)
  let spreadsheetLike = roles.contains { spreadsheetRoles.contains($0) }
  let textLike = roles.contains { textRoles.contains($0) }
  payload = [
    "ok": true,
    "roles": roles,
    "spreadsheetLike": spreadsheetLike,
    "textLike": textLike,
  ]
}

if let data = try? JSONSerialization.data(withJSONObject: payload),
   let json = String(data: data, encoding: .utf8) {
  print(json)
}
