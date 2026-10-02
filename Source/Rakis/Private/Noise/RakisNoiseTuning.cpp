#include "Noise/RakisNoiseTuning.h"

#include "Core/RakisSettings.h"
#include "Gameplay/RakisAssetUtils.h"

URakisNoiseTuning::URakisNoiseTuning()
{
	SurfaceMultiplier.Add(ERakisSurface::Sand, 1.0f);
	SurfaceMultiplier.Add(ERakisSurface::PackedSand, 1.4f);
	SurfaceMultiplier.Add(ERakisSurface::Rock, 0.0f);
	SurfaceMultiplier.Add(ERakisSurface::SietchStone, 0.0f);
	// Ткань и металл встречаются только в сиетче — червь их не слышит, но метр/HUD пусть реагирует слабо.
	SurfaceMultiplier.Add(ERakisSurface::Cloth, 0.0f);
	SurfaceMultiplier.Add(ERakisSurface::Metal, 0.0f);
	SurfaceMultiplier.Add(ERakisSurface::Unknown, 1.0f);
}

const URakisNoiseTuning* URakisNoiseTuning::Get()
{
	if (const URakisSettings* Settings = URakisSettings::Get())
	{
		if (const URakisNoiseTuning* Asset = RakisAssets::Load(Settings->NoiseTuning, TEXT("RakisNoiseTuning")))
		{
			return Asset;
		}
	}
	return GetDefault<URakisNoiseTuning>();
}

float URakisNoiseTuning::GetSurfaceMultiplier(ERakisSurface Surface) const
{
	if (const float* Value = SurfaceMultiplier.Find(Surface))
	{
		return *Value;
	}
	return 1.0f;
}
