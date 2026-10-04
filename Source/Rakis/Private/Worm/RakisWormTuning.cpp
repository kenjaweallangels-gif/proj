#include "Worm/RakisWormTuning.h"

#include "Core/RakisSettings.h"
#include "Gameplay/RakisAssetUtils.h"

const URakisWormTuning* URakisWormTuning::Get()
{
	if (const URakisSettings* Settings = URakisSettings::Get())
	{
		if (const URakisWormTuning* Asset = RakisAssets::Load(Settings->WormTuning, TEXT("RakisWormTuning")))
		{
			return Asset;
		}
	}
	return GetDefault<URakisWormTuning>();
}
