# Texture and data credits

All Earth files are built by `tools/prepare_earth_textures.py` from the sources fetched by `tools/fetch_earth_sources.sh`.

* `earth/season/earth_mMM_4096.jpg` (all presets: the two months bracketing the sim date are blended at load, 'lite'
  loads the nearest one) — NASA Visible Earth, Blue Marble Next Generation 2004 monthly mosaics without topography
  shading or bathymetry (`world.2004MM.3x5400x2700.jpg`), resized; June (not published at that size) is the mean of May
  and July. Sea ice composited over the ocean from the NSIDC Sea Ice Index (G02135, version 4) monthly sea-ice
  concentration 2024, 25 km polar stereographic grids (Fetterer, F. et al., National Snow and Ice Data Center), broken
  into floes by procedural noise. Public domain (NASA); NSIDC data are free to use with attribution.
* `earth/earth_base_m10_8192.jpg` (high, ultra) — Blue Marble Next Generation, October 2004, 21600×10800 original
  (`world.200410.3x21600x10800.jpg`) resized, with the October sea ice. The seasonal difference of the 4K months is
  added to it at load. Public domain.
* `earth/tiles/m10/rRcC.jpg` (ultra) — the same October image at full resolution in 18° tiles (rows 72°N–72°S),
  streamed around the sub-station point. Public domain.
* `earth/earth_night_8192.jpg` (high, ultra), `earth/earth_night_4096.jpg` — NASA Earth Observatory, Black Marble 2016
  (3 km/pixel), city lights only (the blue terrain background removed), grey. Public domain.
* `earth/earth_clouds_8192.jpg` (high, ultra), `earth/earth_clouds_4096.jpg` — NASA Visible Earth "cloud_combined"
  8192×4096, single channel. Public domain.
* `earth/earth_water_8192.png` (high, ultra), `earth/earth_water_4096.png` — water fraction per texel: ocean from
  GEBCO_08 bathymetry (`gebco_08_rev_bath_21600x10800.png`, NASA Visible Earth) and the Blue Marble colour where the
  bathymetry saturates, lakes and reservoirs (polygons) and rivers (lines, width by scale rank) rasterised from
  Natural Earth 1:10m `rivers_lake_centerlines_scale_rank`, `lakes` and the Europe / North America supplements
  (naturalearthdata.com, public domain). GEBCO Compilation Group (free use with attribution).
* `earth/earth_aux_2048.png` — land fraction, ocean depth (GEBCO_08 bathymetry) and land elevation (GEBCO_08
  `gebco_08_rev_elev_21600x10800.png`) for the shaders and the weather placement.
* `earth/earth_normal_4096.jpg`, `earth/earth_normal_2048.jpg` — relief normal maps computed from GEBCO_08 elevation
  (vertical exaggeration 18 at 4K). GEBCO Compilation Group.
Sky, Moon and planets (`public/data/sky`, `public/textures/{sky,moon,planets,dso}`) are packed by
`tools/sky/pack_sky.py` from the outputs of the `tools/sky/build_*.py` scripts (sources: `tools/sky/fetch_gaia.sh`,
`tools/sky/fetch_svs.sh`).

* `data/sky/stars_a.bin` … `stars_d.bin` — HYG database v4.4 (David Nash / astronexus, https://codeberg.org/astronexus/hyg),
  **CC BY-SA 4.0** (`data/sky/LICENSE-HYG.txt`), merged with Gaia DR3 counterparts of the Tycho-2 stars (positions
  propagated to 2026.8, Gaia G / BP−RP converted to Johnson V / B−V). Derived database: CC BY-SA 4.0.
* `data/sky/stars_gaia.bin` (telescope only, loaded on demand) and the Gaia part of `stars_*.bin` — "This work has made
  use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the
  Gaia Data Processing and Analysis Consortium (DPAC)." Credit: ESA/Gaia/DPAC. Licence **CC BY-NC 3.0 IGO**:
  non-commercial use; commercial use needs ESA's permission (data.licences@esa.int).
* `data/sky/star_names.json`, `data/sky/constellations.json` — d3-celestial (© Olaf Frohn, BSD-3-Clause,
  `data/sky/LICENSE-d3-celestial.txt`): IAU / Russian star names, stick figures, IAU boundaries, Russian names; plus
  the IAU WGSN star names.
* `data/sky/dso.json` — OpenNGC (Mattia Verga, https://github.com/mattiaverga/OpenNGC), **CC BY-SA 4.0**; Russian
  names added.
* `sky/milkyway_{8192,4096,2048}.jpg` — NASA/Goddard Space Flight Center Scientific Visualization Studio, Deep Star
  Maps 2020 (https://svs.gsfc.nasa.gov/4851), the Gaia DR2 sky without the Hipparcos-2 / Tycho-2 stars (Gaia DR2:
  ESA/Gaia/DPAC), re-projected to the project's RA/Dec convention. NASA imagery, free to use with credit.
* `moon/moon_color_*.jpg`, `moon/tiles16k/moon_color16k_*.jpg` — NASA's Scientific Visualization Studio, CGI Moon Kit
  (https://svs.gsfc.nasa.gov/4720), LRO LROC WAC colour mosaic (NASA/GSFC/Arizona State University). Public domain.
* `moon/moon_normal_*.jpg`, `moon/tiles16k/moon_normal16k_*.jpg`, `moon/moon_height_{2048,4096}.bin` — computed
  from LOLA (LRO Lunar Orbiter Laser Altimeter, NASA/GSFC) 64 px/deg elevation, CGI Moon Kit. Public domain.
* `planets/{mercury,venus_clouds,mars}_{2048,4096}.jpg`, `planets/{saturn,uranus,neptune}_2048.jpg`,
  `planets/saturn_ring_2048x64.png` — Solar System Scope (INOVE, https://www.solarsystemscope.com/textures/),
  **CC BY 4.0**.
* `planets/jupiter_cassini_3600.jpg` — NASA/JPL/Space Science Institute, PIA07782 (Cassini). Public domain.
* `dso/*.jpg` — deep-sky images, each **CC BY 4.0**, re-projected (gnomonic, north up) and background-subtracted:
  * `dso_m1.jpg` (M1) — NASA , ESA and Allison Loll/Jeff Hester (Arizona State University). Acknowledgement: Davide De Martin ( ESA / Hubble ) — CC BY 4.0 (ESA/Hubble) — https://esahubble.org/images/heic0515a/
  * `dso_m8.jpg` (M8) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso0936a/
  * `dso_m13.jpg` (M13) — T.A. Rector (University of Alaska Anchorage) and H. Schweiker (WIYN and NOIRLab/ NSF /AURA) — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m13kpno4m/
  * `dso_m16.jpg` (M16) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso0926a/
  * `dso_m17.jpg` (M17) — ESO/INAF-VST/OmegaCAM. Acknowledgement: OmegaCen/Astro-WISE/Kapteyn Institute — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1119a/
  * `dso_m20.jpg` (M20) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso0930b/
  * `dso_m27.jpg` (M27) — T.A. Rector (University of Alaska Anchorage) and H. Schweiker (WIYN and NOIRLab/ NSF /AURA) — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m27-kpno-mayall-4-m/
  * `dso_m31.jpg` (M31) — NASA , ESA , Digitized Sky Survey 2 (Acknowledgement: Davide De Martin) — CC BY 4.0 (ESA/Hubble) — https://esahubble.org/images/heic1502b/
  * `dso_m33.jpg` (M33) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1424a/
  * `dso_m42.jpg` (M42) — ESO/G. Beccari — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1723a/
  * `dso_m45.jpg` (M45) — NOIRLab/NSF/AURA/T.A. Rector (University of Alaska Anchorage), R. Cool (University of Arizona) and WIYN — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m45/
  * `dso_m51.jpg` (M51) — K. Rhode, M. Young and WIYN/NOIRLab/ NSF /AURA/ — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao1309a/
  * `dso_m57.jpg` (M57) — NASA, ESA, and C. Robert O’Dell (Vanderbilt University). — CC BY 4.0 (ESA/Hubble) — https://esahubble.org/images/heic1310a/
  * `dso_m64.jpg` (M64) — NOIRLab/ NSF /AURA — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-02330/
  * `dso_m77.jpg` (M77) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1720a/
  * `dso_m78.jpg` (M78) — ESO/Igor Chekalin — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1105a/
  * `dso_m81.jpg` (M81) — T.A. Rector (University of Alaska Anchorage) and NOIRLab/ NSF /AURA/ — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m81m82/
  * `dso_m82.jpg` (M82) — T.A. Rector (University of Alaska Anchorage) and NOIRLab/ NSF /AURA/ — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m81m82/
  * `dso_m83.jpg` (M83) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso0825a/
  * `dso_m101.jpg` (M101) — T.A. Rector (University of Alaska Anchorage) and H. Schweiker (WIYN and NOIRLab/ NSF /AURA) — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m101ubviha/
  * `dso_m104.jpg` (M104) — ESA/Hubble & NASA, K. Noll — CC BY 4.0 (ESA/Hubble) — https://esahubble.org/images/heic2506a/
  * `dso_m7.jpg` (M7) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1406a/
  * `dso_m15.jpg` (M15) — NASA, ESA, Digitized Sky Survey 2 — CC BY 4.0 (ESA/Hubble) — https://esahubble.org/images/heic1321b/
  * `dso_m44.jpg` (M44) — KPNO/NOIRLab/NSF/AURA/Tom Bash and John Fox/Adam Block — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao-m44bash/
  * `dso_ngc5139.jpg` (NGC 5139) — ESO/INAF-VST/OmegaCAM. Acknowledgement: A. Grado, L. Limatola /INAF-Capodimonte Observatory — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1119b/
  * `dso_ngc104.jpg` (NGC 104) — ESO/M.-R. Cioni/VISTA Magellanic Cloud survey. Acknowledgment: Cambridge Astronomical Survey Unit — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1302a/
  * `dso_lmc.jpg` (LMC) — CTIO/NOIRLab/NSF/AURA/SMASH/D. Nidever (Montana State University) Acknowledgment: Image processing: Travis Rector (University of Alaska Anchorage), Mahdi Zamani & Davide de Martin — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noirlab2030a/
  * `dso_smc.jpg` (SMC) — CTIO/NOIRLab/NSF/AURA/SMASH/D. Nidever (Montana State University) Acknowledgment: Image processing: Travis Rector (University of Alaska Anchorage), Mahdi Zamani & Davide de Martin — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noirlab2030b/
  * `dso_ngc3372.jpg` (NGC 3372) — ESO. Acknowledgement: VPHAS+ Consortium/Cambridge Astronomical Survey Unit — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1250a/
  * `dso_ngc7293.jpg` (NGC 7293) — NASA, NOAO, ESA, the Hubble Helix Nebula Team, M. Meixner (STScI), and T.A. Rector (University of Alaska Anchorage/NSF NOIRLab) — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noao0307a/
  * `dso_ngc2070.jpg` (NGC 2070) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1816a/
  * `dso_ngc5128.jpg` (NGC 5128) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso1221a/
  * `dso_ngc253.jpg` (NGC 253) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso9903a/
  * `dso_ngc4755.jpg` (NGC 4755) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso0940b/
  * `dso_b33.jpg` (Horsehead Nebula) — ESO — CC BY 4.0 (ESO) — https://www.eso.org/public/images/eso0202a/
  * `dso_ngc2237.jpg` (NGC 2237) — CTIO/NOIRLab/DOE/NSF/AURA Image Processing: T.A. Rector (University of Alaska Anchorage/NSF NOIRLab), D. de Martin & M. Zamani (NSF NOIRLab) — CC BY 4.0 (NOIRLab) — https://noirlab.edu/public/images/noirlab2424a/
  * `dso_ngc6543.jpg` (NGC 6543) — ESA , NASA , HEIC and The Hubble Heritage Team ( STScI / AURA ) — CC BY 4.0 (ESA/Hubble) — https://esahubble.org/images/heic0414a/
* Ephemeris constants (src/core/Ephemeris.js): JPL Solar System Dynamics (approximate planetary elements, Standish &
  Williams 1992; physical parameters), IAU WGCCRE 2009 rotation models (Archinal et al. 2011), Meeus, Astronomical
  Algorithms (2nd ed.), Mallama & Hilton 2018 magnitudes.

Weather (cloud evolution, tropical cyclones, thunderstorms and lightning), aurora and everything else in the scene
(station, ships, suit, HUD, materials) is procedural and generated at runtime.
