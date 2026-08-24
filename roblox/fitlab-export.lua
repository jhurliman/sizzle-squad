-- FitLab exporter — paste into Roblox Studio's COMMAND BAR (View -> Command
-- Bar) after tuning hats in FitLab.rbxl, press Enter, and copy the printed
-- JSON from the Output window. Merge it with: node roblox/merge-fits.mjs <file>
local HttpService = game:GetService("HttpService")
local out = {}
local function r(n) return math.floor(n * 100 + 0.5) / 100 end
for _, slot in workspace.FitLab:GetChildren() do
	local species, hatId = slot.Name:match("^Slot_(%w+)_(.+)$")
	if species then
		local hat = slot:FindFirstChild("Hat")
		local ref = slot:FindFirstChild("AttachRef")
		if hat and ref then
			local rel = ref.CFrame:Inverse() * hat:GetPivot()
			local rx, ry, rz = rel:ToEulerAnglesXYZ()
			local ext = hat:GetExtentsSize()
			local scale = hat:GetAttribute("BuiltScale") * (ext.X / hat:GetAttribute("BuiltExtentX"))
			out[species] = out[species] or {}
			out[species][hatId] = {
				offset = { r(rel.X), r(rel.Y), r(rel.Z) },
				tilt = { r(math.deg(rx)), r(math.deg(rz)), r(math.deg(ry)) },
				scale = r(scale),
			}
		end
	end
end
print("FITLAB_EXPORT_BEGIN")
print(HttpService:JSONEncode(out))
print("FITLAB_EXPORT_END")
