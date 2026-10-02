#include "Hydration/RakisHydrationTuning.h"

#include "Core/RakisSettings.h"
#include "Gameplay/RakisAssetUtils.h"

const URakisHydrationTuning* URakisHydrationTuning::Get()
{
	if (const URakisSettings* Settings = URakisSettings::Get())
	{
		if (const URakisHydrationTuning* Asset = RakisAssets::Load(Settings->HydrationTuning, TEXT("RakisHydrationTuning")))
		{
			return Asset;
		}
	}
	return GetDefault<URakisHydrationTuning>();
}
