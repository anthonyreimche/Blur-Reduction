# Blur Reduction for Safelight

A [Safelight](https://github.com/anthonyreimche/SafeLight) extension that
undoes blur: the streak left when the camera or the subject moved, the soft
disc of a missed focus, and an even, Gaussian softness. You tell it the
blur's shape and size, and it works the detail back out by deconvolution.

It works best on mild blur in a clean photo. Detail a strong blur wiped out
can't come back, and noise is sharpened along with everything else, which
is what Noise suppression holds down.

## The controls

- **Enabled**: the switch. Off is where a photo starts, so an untouched
  photo costs nothing.
- **Blur**: the blur's shape.
  - **Motion**: a straight streak.
    - **Length** (0 to 100 px): how long the streak is.
    - **Angle** (−90° to 90°): its direction, counter-clockwise from
      horizontal.
    - **Trace streak**: click it, then drag on the photo along a streak, from
      one end to the other, such as a point of light smeared into a line.
      Release, and Length and Angle are set from it. Zoom and pan still
      work while it's on, so you can trace a short streak at 100 %. Esc
      cancels.
  - **Focus**: a disc. **Radius** (0 to 15 px) is the disc's radius.
  - **Gaussian**: a soft, even blur. **Radius** (0 to 15 px) is its standard
    deviation.
- **Iterations** (1 to 100, default 20): how far the deconvolution goes.
  More restores more detail, and more noise and ringing, at more cost.
- **Noise suppression** (0 to 100, default 20): holds back the noise and the
  ringing the deconvolution builds up, at some cost to fine detail.
- **Amount** (0 to 100 %, default 100 %): how much of the result is mixed in.

Sizes are in the full-size photo's pixels. Develop's smaller render and
thumbnails scale them down, so a preview undoes the same blur an export
does. Judge the result at 100 %.

**In masks:** blur that isn't the same across the photo (a moving subject
on a still background) can be fixed where it is: add Blur Reduction to a
mask from the Masking panel's Adjust tab. Trace streak then sets that
mask's blur.

## Tips

- Find the blur's size on something small and bright: a highlight, a light,
  a fine line. Trace it, then raise Iterations until edges are crisp and
  back off when they ring.
- Too long a streak or too large a radius makes halos and ripples; too
  short leaves the blur.
- Clipped highlights have lost what the blur spread out, so they ring.
  Lower Iterations, or mask them out.

## How it works

Blur is the sharp scene convolved with a kernel: the streak, the disc or
the Gaussian. Richardson-Lucy deconvolution estimates the sharp scene by
repeating

    estimate ← estimate × K ⊗ (photo ÷ K ⊗ estimate)

starting from the photo, where ⊗ is convolution with the kernel K. Each
round makes the estimate, blurred, closer to the photo. Noise suppression
adds total-variation regularization (Dey et al., 2006), which divides each
round by 1 − λ div(∇ estimate / |∇ estimate|) and so smooths small
wiggles while keeping edges.

- **The values it works on:** luminance (Rec.709 weights) in linear light,
  after exposure and noise reduction and before any tone mapping, since
  that's where a blur is a convolution. Each pixel's RGB is scaled by its
  new luminance over its old, so colours stay as they were.
- **The kernels:** the streak takes one step per pixel along its longer
  axis, the ends weighted by how much of the pixel they cover, and each
  step splits between the two pixels it falls between. The disc's edge is
  anti-aliased. The Gaussian takes each pixel's share of the curve and is
  applied along rows, then columns.
- **Edges of the photo** repeat outward.

### On the GPU

One GPU pass carries four values per pixel from draw to draw: the estimate
as a half float and its remainder (about 22 bits), and two running sums,
stored as differences or ratios less 1 so half floats keep them precise.
Every read is an exact texel fetch.

- Each round is one draw per 48 kernel taps for each of its two
  convolutions, plus one draw for the update. A 10 px streak at full size
  is three draws a round; a 15 px disc is 33.
- No draw reads more than 56 texels per pixel.
- A pass makes at most 1024 draws; rounds that don't fit are dropped.
  Only the largest discs at full size reach that.
- Amount is applied after the pass, so changing it is free.

## Tests

- `npm test`: the CPU model (kernels, the schedule, deconvolution of a
  blurred scene, noise suppression), the bag contract, the stage's shape
  and per-draw reads, the panel and the trace tool, and the built bundle
  (run `npm run build` first).
- `npm run test:gpu`: renders the stage in a Safelight checkout's WebGL rig
  (headless Chromium on SwiftShader) and compares it with the CPU model for
  every blur, the streak's direction, colour, and a render smaller than the
  photo. Set `SAFELIGHT_CORE` if the checkout isn't beside this folder.

## Licence

GPL-3.0-or-later.
