# Device test checklist

Automated tests cover the pure logic (flood fill, QuickShape, rulers, liquify maths, PSD and brush
file formats, shortcuts, project format). Everything below touches drawing, gestures, native code
or the GPU and must be checked on a real phone **and** tablet (Android and iOS) with a new
development build. Tick each line; note the device if something fails.

## Build
- [ ] New dev build installs and opens (includes the `zumi-video-encoder` and `zumi-keyboard` modules and `expo-secure-store`).
- [ ] An artwork saved with the previous build still opens (layers, clip/mask flags kept).

## Fill & selection
- [ ] Paint bucket fills a closed line-art area on another layer (Area: All layers), no white fringe (Grow 2 px).
- [ ] Mark the line art as **Reference**, set Area: Reference — fill ignores colours on other layers.
- [ ] Bucket respects selection and alpha lock. Undo restores.
- [ ] Magic wand selects an area; Add / Subtract / Intersect combine with an existing rectangle selection.
- [ ] Select layer content, Grow/Shrink 4 px, Feather (paint across the soft edge), Crop to selection.

## Canvas
- [ ] Canvas size: extend with each of the 9 anchors; crop smaller; Scale image; Rotate 90°/180°; Flip. Vector layers keep editable shapes. Undo/redo each.
- [ ] Timelapse keeps recording after a resize (it restarts at the new size).

## Tools
- [ ] Gradient: linear, radial, tone gradient (dots shrink along the drag); live preview matches the result; selection and alpha lock respected.
- [ ] Text: fonts, bold/italic, alignment, outline; added in view, then Transform places it.
- [ ] Adjustments: every item previews live and Apply matches the preview; only the selection changes when one exists; Cancel leaves the layer untouched.
- [ ] Liquify: push, twirl both ways, pinch, expand, restore; Reset; Cancel discards; Apply matches.
- [ ] QuickShape: hold at the end of a line, circle, ellipse, triangle, rectangle, zigzag; scribbles stay as drawn; Settings toggle and hold time work.
- [ ] Rulers (Guides panel): straight, parallel, ellipse, focus lines; drag both handles; strokes snap.
- [ ] Smudge brushes drag colour; Blender brushes mix; preview roughly matches the commit.

## Layers
- [ ] Group selected layers; fold/unfold; hide; opacity and blend of the group; rename; ungroup; merge group; delete group. Undo each.
- [ ] Moving a layer past a group edge leaves the group; into the middle joins it.
- [ ] Clip and mask inside a group render the same on screen, in PNG export and in PSD.

## Animation
- [ ] Turn on Animation; add, duplicate and select frames; onion skins show (red before, green after).
- [ ] Play at several fps; loop, ping-pong, once; background frame option.
- [ ] Export animation as GIF and MP4.

## Export & brushes
- [ ] Layered PSD opens in Photoshop / Krita / Clip Studio / Procreate with names, opacity, blend modes, visibility, clipping, masks and groups.
- [ ] History panel: jump back several steps and forward again.
- [ ] Brush Studio: picture tip from a photo; brush shows the picture shape. Share a brush, import it on another device (tip included).

## Keyboard (tablet with keyboard)
- [ ] Ctrl/⌘ Z and ⇧Z, B, E, [ ], Ctrl/⌘ 0, Ctrl/⌘ S, Esc, ? (help) work; typing in text fields is unaffected.

## First run
- [ ] Welcome tips appear once on a fresh install; Settings › Welcome tips › Show again shows them.
## Export formats
- [ ] An artwork saved with the old animated brushes opens with those layers as ordinary still layers.
- [ ] Export dialog offers PNG, JPEG, WebP, GIF, MP4 (with the video encoder) and PSD.
- [ ] GIF and MP4 exports show the still artwork (MP4 as a 2 s clip).
- [ ] Gallery "Share" / "Save to Photos" work for every format.
