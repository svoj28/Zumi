/**
 * The assistant's knowledge base: art fundamentals, illustration and manga craft, idea
 * generation, and a guide to Zumi itself. Each question pulls the most relevant entries into
 * the prompt (see `searchKnowledge`), so answers stay grounded and specific without sending
 * the whole base every time.
 *
 * Sources consulted while compiling (October 2026): Procreate Handbook (colour harmonies),
 * Draw Paint Academy (colour schemes), CUNY OpenLab colour review, Clip Studio Tips (screentone,
 * tonal techniques, flatting & masking, perspective basics, efficient shading), David Revoy's
 * Krita workflow, Disney Family Museum silhouette guide, Duolingo character illustration
 * guidelines, Rocketbrush (shape language), and general composition study guides. Fundamentals
 * (light & form, proportion, gesture) follow long-standing teaching such as Loomis-style
 * proportion and form-shadow theory.
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  /** Words and phrases people use when asking about this. */
  tags: string[];
  text: string;
}

export const KNOWLEDGE: readonly KnowledgeEntry[] = [
  // ---- colour -------------------------------------------------------------------------------
  {
    id: 'color-harmony',
    title: 'Colour harmonies',
    tags: ['color', 'colour', 'palette', 'harmony', 'scheme', 'complementary', 'analogous', 'triadic', 'split', 'tetradic', 'monochromatic', 'wheel'],
    text: `Harmonies are starting points on the colour wheel, not rules.
- Monochromatic: one hue in many values and saturations. Calm, unified; rely on value contrast.
- Analogous: 3 neighbouring hues (e.g. yellow-orange-red). Cohesive warm or cool mood with little tension; pick one dominant, use the others for variation.
- Complementary: opposite hues (blue/orange, red/green, purple/yellow). Strongest contrast; let one dominate and use the other as an accent near the focal point. Mixing them makes rich neutrals.
- Split-complementary: a base hue plus the two hues beside its complement (blue + red-orange + yellow-orange). Contrast with less tension; base hue dominant, the pair for accents.
- Triadic: three evenly spaced hues (red/yellow/blue, orange/green/purple). Lively; choose one dominant and mute the other two, or it looks garish.
- Tetradic/square: two complementary pairs. Rich but hard to balance: one leader, everything else muted.
Proportion matters more than hue choice: a common split is roughly 60% dominant / 30% secondary / 10% accent (the 60-30-10 guideline).`,
  },
  {
    id: 'color-value',
    title: 'Value (light and dark) comes first',
    tags: ['value', 'contrast', 'light', 'dark', 'grayscale', 'greyscale', 'readability', 'notan', 'muddy', 'flat'],
    text: `Value (how light or dark a colour is) carries form and readability more than hue does. A picture that works in greyscale works in colour.
- Plan 3–5 value groups (light, mid, dark). Keep the highest contrast at the focal point.
- Check values: temporarily make a greyscale copy or squint. Different hues can share the same value and blur together.
- "Muddy" colour usually means values too close together or too many desaturated mid-tones; separate light and shadow families.
- Notan: a two-value (black/white) thumbnail tests the design's big shapes.`,
  },
  {
    id: 'color-temperature',
    title: 'Colour temperature, saturation and light',
    tags: ['warm', 'cool', 'temperature', 'saturation', 'chroma', 'vibrant', 'dull', 'shadow color', 'light color', 'atmosphere', 'mood'],
    text: `- Warm light usually gives cooler shadows and vice versa (sunlight warm / sky-lit shadows bluish; cold moonlight / warmer shadows from bounce).
- Saturation peaks near the light-to-shadow transition (the terminator); the brightest highlights and deepest shadows are less saturated.
- Distance (atmospheric perspective): far things get lighter, cooler, less contrasted and less saturated.
- Use saturation as an accent: a mostly muted image makes one saturated area pop.
- Shadows are not black: shift the local colour darker, slightly toward the shadow's temperature, and often slightly more saturated near the edge.`,
  },
  {
    id: 'color-mood',
    title: 'Palettes by mood and theme',
    tags: ['mood', 'theme', 'feeling', 'emotion', 'atmosphere', 'cozy', 'spooky', 'dreamy', 'sad', 'happy', 'romantic', 'mysterious', 'energetic', 'calm', 'palette ideas', 'sunset', 'night', 'forest', 'ocean'],
    text: `Associations are cultural conventions, useful as defaults:
- Cozy / nostalgic: warm oranges, honey yellows, soft browns, muted reds; low contrast, warm light. e.g. #3b2a20 #7a4b2a #c9803e #f2c36b #fbe7c6
- Calm / peaceful: desaturated blues and greens, soft whites. e.g. #1f3b4d #3f6e7a #8fb3b0 #d7e6df #f6f4ee
- Mysterious / night: deep blues and purples with one warm light source. e.g. #0e1027 #22264b #4b3f72 #8a6fb0 #f6c56b
- Spooky: sickly greens, deep purples, near-black, a hint of orange. e.g. #0d0b14 #2b1d3a #4f6b3a #a7c957 #f28c28
- Dreamy / pastel: high value, low saturation pinks, lilacs, mints. e.g. #f7d6e0 #e2c6f2 #c6e2f2 #d4f2e1 #fff3d6
- Energetic: saturated complementaries with strong value contrast. e.g. #111111 #ff3c38 #ffd23f #2ec4b6 #f6f7f8
- Melancholy: greyed blues, slate, washed-out warm accent. e.g. #2d3142 #4f5d75 #8d99ae #bfc0c0 #c9a690
- Sunset: purple → magenta → orange → gold. e.g. #2b1b4a #6b2d6b #d1495b #f28f3b #ffd166
- Forest: varied greens with warm earth and cool shadow. e.g. #13261d #2d4a2f #5c7f3a #a3b85a #d9c48a
- Ocean: teals, blues, sand and foam. e.g. #03256c #2541b2 #1768ac #06bee1 #f4e9d8
Always vary value inside a palette (dark, mid, light) so it can carry form.`,
  },
  {
    id: 'palette-building',
    title: 'Building a usable palette',
    tags: ['make palette', 'create palette', 'limited palette', 'swatches', 'skin tone', 'skin', 'hex', 'color picking', 'colour picking'],
    text: `- Start limited: 4–6 colours (one dark, one light, a dominant hue, a secondary, an accent). Add in-between mixes as you paint.
- Pick colours in context, next to their neighbours; colours look different on different backgrounds.
- Skin: light family warm (peach/orange), shadows shift toward red/purple-brown, add a little red on cheeks, nose, ears and knuckles; avoid grey shadows. Example light skin: #f6d5c3 #e8a98c #c97b63 #8e4b3f; deep skin: #8d5a3b #6b3f2a #4a2a1d #c88a5a (warm highlight).
- Give every palette a darkest dark and a lightest light; reserve pure white/black for small accents.
- Hue shifting: as colours get darker, rotate hue slightly (yellow → orange → red-brown) instead of only adding black.`,
  },

  // ---- composition --------------------------------------------------------------------------
  {
    id: 'composition',
    title: 'Composition fundamentals',
    tags: ['composition', 'layout', 'focal point', 'rule of thirds', 'framing', 'balance', 'leading lines', 'eye flow', 'crop', 'arrangement', 'golden ratio'],
    text: `- Decide the focal point first; give it the highest contrast (value, colour, detail, edge sharpness).
- Rule of thirds: place key elements on the 3×3 grid lines or intersections; let the subject occupy one or two thirds rather than dead centre (centred works for calm, symmetric, iconic images).
- Leading lines (roads, rivers, limbs, gazes, architecture) steer the eye to the subject; avoid lines that lead out of the frame.
- Rule of space: leave room in the direction a character looks or moves.
- Rule of odds: 3 or 5 elements often feel livelier than 2 or 4.
- Vary shape sizes (big / medium / small) and spacing; avoid tangents (edges that just touch).
- Framing: foreground elements, doorways or branches frame the subject and add depth.
- Thumbnails: tiny, fast (1–3 min) sketches of several layouts before committing; judge them small.`,
  },
  {
    id: 'depth',
    title: 'Creating depth',
    tags: ['depth', 'foreground', 'background', 'midground', 'overlap', 'atmospheric perspective', 'scale', 'layers of depth', 'environment', 'landscape'],
    text: `- Overlap: near things cover far things — the strongest depth cue.
- Size and position: far objects smaller and higher (toward the horizon).
- Atmospheric perspective: lower contrast, lighter, cooler and less detailed with distance.
- Edges: sharp, detailed foreground or focal area; softer edges further away.
- Three planes: foreground (dark or detailed frame), midground (subject), background (simple, lighter).`,
  },

  // ---- light & form -------------------------------------------------------------------------
  {
    id: 'light-shadow',
    title: 'Light, shadow and form',
    tags: ['shading', 'shade', 'shadow', 'light', 'lighting', 'highlight', 'form', 'cast shadow', 'core shadow', 'reflected light', 'rim light', 'ambient occlusion', '3d', 'volume', 'render', 'rendering'],
    text: `Light on a form, from light to dark:
- Highlight (specular): reflection of the light source; sharp on shiny surfaces, broad and soft on matte ones.
- Light side / half-tone: faces turned toward the light, getting darker as they turn away.
- Terminator / core shadow: where the form turns away from the light — the darkest part of the form shadow, edge soft on round forms, hard on angular ones.
- Reflected (bounce) light: light bouncing from nearby surfaces into the shadow; always darker than the light side.
- Cast shadow: shadow thrown on other surfaces; darkest and sharpest where objects touch (occlusion / contact shadow), softer further away.
Tips: pick one main light direction and keep it consistent; group everything into light family vs shadow family; rim light (backlight) separates a character from a dark background.`,
  },
  {
    id: 'materials',
    title: 'Rendering materials',
    tags: ['metal', 'glass', 'hair', 'fabric', 'cloth', 'skin', 'water', 'fur', 'shiny', 'matte', 'texture', 'reflection', 'eyes'],
    text: `- Metal: high contrast, sharp highlights, reflects surroundings, little diffuse colour.
- Glass / water: mostly shows what's behind or reflected; sharp highlights, dark edges, refraction bends lines.
- Skin: soft transitions, warm subsurface glow near the terminator (reddish), small soft highlights on nose, lips, forehead.
- Hair: paint big clumps as shapes first, then a highlight band following the head's form, then a few stray strands.
- Fabric: folds radiate from tension points (shoulders, elbows, knees); cotton matte, silk with sharp long highlights.
- Eyes: the iris shadowed by the upper lid, one clean catchlight, the white of the eye is never pure white.`,
  },

  // ---- figure -------------------------------------------------------------------------------
  {
    id: 'proportions',
    title: 'Human proportions',
    tags: ['anatomy', 'proportion', 'body', 'figure', 'head height', 'heads tall', 'chibi', 'face', 'hands', 'torso', 'legs', 'realistic'],
    text: `Measured in head heights (heads tall):
- Realistic adult ≈ 7.5 heads; idealised/heroic 8–9; manga/anime adults often 7–8 with longer legs; teens 6–7; children 4–5; chibi / super-deformed 2–3.
- Landmarks for an 8-head figure: chin at 1, nipples at 2, navel ≈3, crotch at 4 (midpoint), knees ≈6, feet at 8.
- Shoulders ≈2 head widths (wider for heroic men); hips about shoulder width for women, narrower for men.
- Arms hanging reach mid-thigh; elbows near the waist; a hand is about the face's height.
- Face: eyes at the vertical middle of the head; one eye-width between the eyes; nose bottom halfway between brows and chin; mouth a third of the way from nose to chin; ears from brow line to nose bottom.`,
  },
  {
    id: 'gesture',
    title: 'Gesture and poses',
    tags: ['gesture', 'pose', 'action', 'line of action', 'dynamic', 'stiff', 'movement', 'figure drawing', 'contrapposto', 'balance'],
    text: `- Start every figure with a line of action: one curve (C or S) through the whole body.
- Draw gestures fast (30 s – 2 min): capture motion before anatomy.
- Contrapposto: weight on one leg — that hip rises, the shoulders tilt the opposite way.
- Balance: the centre of gravity sits over the supporting foot (or between both feet).
- Push poses further than feels natural; exaggeration reads as energy. Avoid symmetry (twinning) in arms and legs.
- Use simple forms (bean torso, cylinders for limbs, box for hips) to work out perspective before detail. Zumi's 3D pose figure helps with tricky angles.`,
  },
  {
    id: 'character-design',
    title: 'Character design',
    tags: ['character', 'oc', 'original character', 'design', 'shape language', 'silhouette', 'costume', 'outfit', 'personality', 'mascot', 'creature'],
    text: `- Silhouette test: fill the character solid black and view it tiny; it should still read (role, mood, pose). Keep body, hair and clothes as distinct shapes.
- Shape language (conventions): circles = friendly, soft, safe; squares = sturdy, reliable, stubborn; triangles = dynamic, dangerous, sharp-witted. Mix them, with one dominant.
- Proportion contrast: big vs small parts make designs memorable (huge coat, tiny legs).
- Limit details and colours: 3–4 main colours; repeat one accent colour or motif.
- Design from personality and story: job, era, climate, habits, what they carry and why.
- Make a model sheet: front, side and back views plus expressions to stay on-model.
- Brief-builder: [age/role] + [personality trait] + [setting] + [visual twist]. e.g. "a nervous young lighthouse keeper in a floating city who collects broken compasses".`,
  },
  {
    id: 'expressions',
    title: 'Faces and expressions',
    tags: ['expression', 'emotion', 'face', 'eyes', 'mouth', 'eyebrows', 'smile', 'angry', 'crying', 'cute'],
    text: `- Brows carry most of the emotion: raised = surprise or worry, pulled down and together = anger or focus, inner corners up = sadness.
- Eyes: wide for fear or surprise, narrowed for suspicion, happy eyes squeeze from below (cheeks push up).
- Mouth shape follows the jaw; open mouths drop the jaw, so the chin moves down.
- Push asymmetry (one brow higher, a lopsided smile) for life.
- In manga, stylised symbols add emotion: blush lines, sweat drop, vein mark, sparkles.`,
  },

  // ---- perspective --------------------------------------------------------------------------
  {
    id: 'perspective',
    title: 'Perspective',
    tags: ['perspective', 'vanishing point', 'horizon', 'eye level', 'one point', 'two point', 'three point', 'background', 'room', 'building', 'foreshortening', 'camera angle', 'birds eye', 'worms eye'],
    text: `- The horizon line is the viewer's eye level; parallel lines meet at a vanishing point on it.
- One-point: looking straight at a surface (corridors, roads, rooms seen head-on).
- Two-point: looking at a corner; two vanishing points on the horizon, set far apart to avoid distortion.
- Three-point: very high or low viewpoints; a third point above (worm's-eye) or below (bird's-eye) adds drama.
- Figures standing on the same ground with a camera at their eye height all have eyes on the horizon.
- Foreshortening: things pointing at the viewer overlap and look shorter; use overlapping cylinders.
In Zumi: open Guides and turn on perspective (1, 2 or 3 points); drag the vanishing points; strokes can snap to perspective lines.`,
  },

  // ---- manga & comics -----------------------------------------------------------------------
  {
    id: 'manga-inking',
    title: 'Inking (lineart)',
    tags: ['ink', 'inking', 'lineart', 'line art', 'line weight', 'lines', 'clean lines', 'outline', 'g-pen', 'pen'],
    text: `- Line weight: thicker on the outside contour, at overlaps and on the shadow side; thinner for interior detail and in light.
- Taper line ends (pressure) for a lively, brush-like feel; thick-to-thin strokes suggest form.
- Draw from the elbow or shoulder for long curves; rotate the canvas so you pull lines in your comfortable direction.
- Use stabiliser/smoothing for long clean curves; less for hatching.
- Close shapes cleanly (gaps break fills), and ink on a separate layer above the sketch, sketch layer lowered in opacity.
In Zumi: G-Pen, Maru Pen, Kabura Pen and Studio Pen are pressure-sensitive inking pens; raise smoothing in the brush settings or the global stabiliser.`,
  },
  {
    id: 'manga-tones',
    title: 'Screentone and manga shading',
    tags: ['screentone', 'tone', 'halftone', 'dots', 'manga shading', 'black and white', 'hatching', 'crosshatch', 'gradient tone', 'tone scraping'],
    text: `- Screentone (halftone dots) adds shading, gradients and texture in black and white; originally adhesive sheets cut by hand.
- Use 2–3 tone values per page so values stay readable; dense/dark tones for shadow, light tones for skin shading or sky.
- Keep line frequency consistent across a page; mixing many dot sizes looks busy.
- Gradient tones: soft-shade by erasing tone with a soft eraser or airbrush, or use a mask so you can edit later.
- Hatching and cross-hatching are the classic hand methods; heavier cross-hatching suggests tension, lighter hatching unease.
- Flat black shadow blocking is fast and strong — good for deadlines and dramatic lighting.
- Special tones: crosshatch for texture or gloom, sand/stipple for grit, rings and bubbles for sparkle or dreamy backgrounds, diagonal lines for motion or tension.
In Zumi: the Screentone brushes (dots, rings, sand, lines, crosshatch) have adjustable circle size, density, circle size variation (mixed-size dots) and pattern angle (45° for diagonal tone). Tone stays fixed to the canvas so strokes line up.`,
  },
  {
    id: 'manga-effects',
    title: 'Manga effects and paneling',
    tags: ['panel', 'paneling', 'page', 'comic', 'manga page', 'speech bubble', 'speed lines', 'focus lines', 'effects', 'storyboard', 'pacing', 'gutter', 'sfx'],
    text: `- Reading order: manga right-to-left, western comics left-to-right; arrange panels and bubbles so the order is obvious.
- Pacing: wide or tall panels slow time; many small panels speed it up; a full-page splash for big moments.
- Vary shots: establishing wide shot, medium, close-up, extreme close-up; keep the 180° rule in conversations.
- Speed lines: parallel lines in the direction of motion; focus (radial) lines converge on a subject for impact or shock.
- Leave room for bubbles when composing; tails point at the speaker's mouth.
- Gutters (space between panels) are usually even; break the border for impact.
In Zumi: the comic panel layouts set up page panels; use the Lines tone or a ruler-like stabilised pen for speed lines.`,
  },

  // ---- workflow -----------------------------------------------------------------------------
  {
    id: 'workflow',
    title: 'Digital illustration workflow',
    tags: ['workflow', 'steps', 'process', 'how to start', 'beginner', 'sketch', 'flats', 'flatting', 'render', 'finish', 'layers', 'order'],
    text: `A typical layer-based process:
1. Thumbnails / rough sketch (low opacity, messy is fine).
2. Refined sketch, then lineart on a new layer.
3. Flats: one solid base colour per area on its own layer(s) under the lineart — makes selections and clipping easy.
4. Shadows on a clipping layer above the flats (often Multiply, a darker hue-shifted colour, not black).
5. Lights/highlights on another clipping layer (Screen/Add or a lighter colour).
6. Effects: glow, rim light, atmosphere, colour adjustments; finally merge or tidy.
Name your layers, flip the canvas to spot mistakes, zoom out often, and work big shapes before details.`,
  },
  {
    id: 'blend-modes',
    title: 'Layer blend modes',
    tags: ['blend mode', 'multiply', 'screen', 'overlay', 'add', 'soft light', 'hard light', 'color dodge', 'glow', 'layer mode'],
    text: `- Multiply: darkens; great for shadows and lineart over colour (white disappears).
- Screen: lightens; soft light and haze.
- Add (linear dodge) / Color Dodge: intense glows, fire, magic, light rays — use sparingly.
- Overlay / Soft Light: adds contrast and colour tint while keeping detail.
- Color / Hue: recolour without changing values.
- Luminosity: change values only.
Tip: a shadow layer in Multiply with a purple-blue colour, clipped to the flats, is a quick consistent shadow pass.`,
  },
  {
    id: 'blending-painting',
    title: 'Painting and blending techniques',
    tags: ['blend', 'blending', 'smooth', 'soft', 'gradient', 'airbrush', 'painterly', 'brush strokes', 'cel shading', 'soft shading', 'texture'],
    text: `- Cel (anime) shading: hard-edged shadow shapes, 1–2 tones per area; clean and fast.
- Soft shading: lay hard shapes first, then soften only where forms turn gradually — keep some hard edges.
- Blend by colour-picking in-between tones and painting at low opacity, or with a blender brush.
- Airbrush for large soft gradients, glows and atmosphere; avoid airbrushing everything (it looks plastic).
- Edge control: hard edges attract the eye; lost (soft) edges recede.
- Texture brushes (chalk, pastel, sponge) add surface interest; use them late and sparingly.
In Zumi: the Blending brushes (Blender, Soft Blender, Detail Blender, Textured Blender, Blur) mix the colours already on the layer; any brush can blend with the "Blend" slider.`,
  },
  {
    id: 'backgrounds',
    title: 'Backgrounds and environments',
    tags: ['background', 'environment', 'scenery', 'landscape', 'city', 'interior', 'sky', 'clouds', 'trees', 'nature', 'architecture'],
    text: `- Block in big shapes and values first; most backgrounds need only 3–4 values.
- Skies: gradient lighter toward the horizon; clouds have a lit top, shadowed base, and get smaller and flatter toward the horizon.
- Trees: paint the mass and silhouette, then lit clumps, then a few gaps where the sky shows through.
- Architecture: use perspective guides; add wear, signs and lived-in details at the focal area only.
- Keep the background lower in contrast and detail than the character, unless the scene is the subject.`,
  },

  // ---- ideas & practice ---------------------------------------------------------------------
  {
    id: 'ideas',
    title: 'Finding ideas: what to draw',
    tags: ['idea', 'ideas', 'what to draw', 'prompt', 'inspiration', 'theme', 'challenge', 'subject', 'random', 'concept', 'story'],
    text: `Idea generators:
- Combine: [subject] + [setting] + [twist]. e.g. "a cat librarian / in a sunken cathedral / during a lantern festival".
- Mash-ups: two unrelated things (jellyfish + hot-air balloon; samurai + gardener).
- Re-imagine: a fairy tale in another era or genre (cyberpunk Red Riding Hood).
- Moments: draw a story beat — just before or just after something happens.
- Mood first: choose a feeling and a palette, then invent a scene that fits.
- Studies: master copies, still lifes, 30-second gestures, value studies of photos.
Good drawing prompts are specific about subject, action, setting, mood and lighting, and leave room for the artist's style.`,
  },
  {
    id: 'themes',
    title: 'Theme and genre inspiration',
    tags: ['theme', 'genre', 'fantasy', 'sci-fi', 'scifi', 'cyberpunk', 'steampunk', 'cottagecore', 'horror', 'slice of life', 'kawaii', 'retro', 'vaporwave', 'solarpunk', 'dark fantasy', 'seasonal', 'halloween', 'christmas', 'spring', 'summer', 'autumn', 'winter'],
    text: `Theme toolkits (motifs + palette direction):
- Fantasy: castles, runes, glowing artefacts, creatures; jewel tones with warm magic light.
- Dark fantasy: ruins, thorns, armour; desaturated with a single blood-red or gold accent.
- Sci-fi: clean shapes, panels, holograms; cool blues/whites with cyan or orange accents.
- Cyberpunk: neon signs, rain, crowded streets; magenta + cyan neon over near-black, wet reflections.
- Steampunk: brass, gears, airships, Victorian clothing; browns, copper, cream.
- Solarpunk: greenery on architecture, solar panels, bright optimism; greens, sunny yellow, white.
- Cottagecore: gardens, baking, cottages; soft greens, cream, floral pinks.
- Horror: wrong proportions, darkness, implied threats; low-key lighting, sickly greens.
- Slice of life: everyday moments, rooms, food; natural light, warm comfortable palettes.
- Kawaii: round shapes, pastel colours, simple faces, sparkles.
- Retro / vaporwave: 80s–90s grids, sunsets, statues; pink, purple, teal gradients.
- Seasons: spring pastels and blossoms; summer saturated and high contrast; autumn oranges and browns; winter blues, whites and warm window light.`,
  },
  {
    id: 'practice',
    title: 'Practice, art block and improvement',
    tags: ['practice', 'improve', 'art block', 'motivation', 'burnout', 'learn', 'study', 'routine', 'beginner', 'exercise', 'critique', 'feedback'],
    text: `- Short daily sessions beat rare long ones. Mix fun pieces with focused studies (one fundamental at a time).
- Art block: lower the stakes — doodle with a new brush, redraw an old piece, try a tiny limited-palette study, use a random prompt, or draw from life.
- Self-critique checklist: readable silhouette? clear focal point? 3–5 value groups? consistent light? colour harmony? flip the canvas — does anything look off?
- Copy masters to learn decisions (not to post as your own); study from photos and life.
- Finish pieces: completed imperfect work teaches more than abandoned perfect sketches.`,
  },
  {
    id: 'styles',
    title: 'Art styles',
    tags: ['style', 'anime', 'manga style', 'realistic', 'semi-realistic', 'cartoon', 'chibi', 'painterly', 'flat', 'lineless', 'pixel', 'watercolor', 'watercolour', 'comic style'],
    text: `- Anime/manga: clean lineart, cel shading, large expressive eyes, simplified noses and mouths.
- Semi-realistic: realistic proportions and lighting with stylised faces and simplified rendering.
- Cartoon: exaggerated shapes and proportions, bold outlines, flat or simple shading.
- Painterly: visible brush strokes, colour mixing, few or no lines.
- Lineless: shapes defined by colour and value edges instead of outlines.
- Flat / vector-like: solid colour shapes, few gradients; strong silhouettes.
- Watercolour look: transparent layered washes, soft edges, paper texture, white kept from the paper.
Developing your own style comes from your choices of shape, line, colour and subject repeated over many drawings.`,
  },

  // ---- Zumi ---------------------------------------------------------------------------------
  {
    id: 'zumi-brushes',
    title: 'Zumi: brushes and Brush Studio',
    tags: ['zumi', 'brush', 'brushes', 'pen', 'pencil', 'airbrush', 'blender', 'brush studio', 'custom brush', 'create brush', 'eraser', 'stabilizer', 'smoothing', 'pressure', 'texture brush'],
    text: `- Brush library categories: Sketching, Inking, Painting, Blending, Airbrush, Texture, Screentone, My Brushes. Star brushes to add them to Favourites; Recent lists what you used.
- Create your own brush: Brushes › "Create your own brush" (or +) opens Brush Studio — pick a starting point (Pen, Pencil, Marker, Paint, Airbrush, Blender, Chalk, Spray, Screentone, Stamp), choose a tip shape (round, flat, pencil, chalk, charcoal, grain, square, triangle, star, heart, leaf, splat), adjust size, softness, opacity, build-up, blend, spacing, scatter, randomness, pressure and texture, try it on the test pad, and Save to My Brushes. Long-press a brush › "Edit in Brush Studio" or "Make my own brush from this".
- Settings tab: every brush parameter (spacing, jitter, pressure curve, tilt, texture).
- Eraser: its own size/opacity/hardness, or "Erase with current brush".
- Steadier lines: brush Smoothing, or Settings › Default smoothing.`,
  },
  {
    id: 'zumi-layers',
    title: 'Zumi: layers, clipping, masks and transform',
    tags: ['zumi', 'layer', 'layers', 'clip', 'clipping', 'clipping mask', 'mask', 'layer mask', 'transform', 'resize', 'rotate', 'warp', 'distort', 'move', 'fill', 'merge', 'alpha lock', 'blend mode', 'opacity'],
    text: `- Layers panel: add, reorder, hide, lock, rename (long-press), opacity and blend mode per layer; duplicate, merge down, merge selected, flatten.
- Clip: the layer only shows where the layer below has pixels — perfect for shading over flats.
- Mask: adds a mask above the layer; paint black to hide, white to show again (Hide/Show buttons set the colour); Invert, Apply mask (erases hidden parts), or hide the mask to turn it off. With a selection, the mask starts from it.
- Transform: move, resize, rotate (two fingers or Rotate 90°), flip, Distort (drag corners for perspective/skew) or Warp (bend edges); Apply or Cancel.
- Fill: fills the layer or the selection with the current colour (alpha lock keeps transparency).
- Alpha lock: paint only where the layer already has pixels.`,
  },
  {
    id: 'zumi-canvas',
    title: 'Zumi: canvas, gestures and tools',
    tags: ['zumi', 'gesture', 'zoom', 'rotate canvas', 'undo', 'redo', 'eyedropper', 'selection', 'symmetry', 'guides', 'reference', 'pose', 'timelapse', 'export', 'preview', 'navigator', 'shapes', 'vector', 'palm rejection', 'stylus'],
    text: `- Two fingers: move, zoom and rotate the canvas (it snaps upright near 0°). Two-finger tap = undo, three-finger tap = redo. Press and hold = eyedropper.
- Selection: rectangle, ellipse or lasso; cut, copy, paste, duplicate, clear, invert.
- Symmetry: mirror strokes (vertical, horizontal, radial); drag the axis handle.
- Guides: grid and 1/2/3-point perspective with snapping.
- References: floating reference image window; 3D pose figure for posing.
- Preview window: a small view of the whole artwork that you can show or hide while zoomed in.
- Shapes and vector layers for clean editable lines; convert a layer to vector.
- Timelapse recording and export (PNG, JPEG, .zumi backup with layers).
- Stylus: automatic palm rejection; "Draw with stylus only" in Settings.`,
  },
  {
    id: 'zumi-color',
    title: 'Zumi: colours and palettes',
    tags: ['zumi', 'color picker', 'colour picker', 'palette', 'swatch', 'save color', 'save colour', 'hex', 'color wheel', 'colour wheel'],
    text: `- The colour panel has a colour wheel, hex entry, saved colours and palettes.
- Palettes suggested by the assistant can be saved with "Save palette" under the answer; they appear in the colour panel as the active palette.
- Palettes can also be generated from images.`,
  },
];

const STOP = new Set(
  'a an and are as at be but by can do does for from how i if in into is it its me my of on or so that the this to was what when where which who why will with you your please tell give some about want need help make'.split(' '),
);

/** Lowercase word tokens without filler words. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * The entries most relevant to `query`: tag phrases count most, then title words, then words in
 * the text. Returns at most `limit` entries with a positive score, best first.
 */
export function searchKnowledge(query: string, limit = 4): KnowledgeEntry[] {
  const q = query.toLowerCase();
  const words = tokenize(query);
  if (!words.length) return [];
  const scored = KNOWLEDGE.map((entry) => {
    let score = 0;
    for (const tag of entry.tags) {
      if (tag.includes(' ') ? q.includes(tag) : words.includes(tag)) score += tag.includes(' ') ? 5 : 3;
      // Plurals and partial forms ("shadows", "palettes").
      else if (words.some((w) => w.length > 3 && (w.startsWith(tag) || tag.startsWith(w)))) score += 1.5;
    }
    const title = tokenize(entry.title);
    for (const w of words) if (title.includes(w)) score += 2;
    const body = entry.text.toLowerCase();
    for (const w of words) if (w.length > 3 && body.includes(w)) score += 0.5;
    return { entry, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
