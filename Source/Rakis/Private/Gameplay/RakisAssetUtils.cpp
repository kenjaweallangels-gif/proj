#include "Gameplay/RakisAssetUtils.h"

#include "Rakis.h"

namespace RakisAssets
{
	void WarnOnce(const FString& Key, const FString& Message)
	{
		// Только игровой поток: загрузка soft-ассетов в этих системах идёт из BeginPlay/таймеров.
		static TSet<FString> Reported;
		if (!Reported.Contains(Key))
		{
			Reported.Add(Key);
			UE_LOG(LogRakis, Warning, TEXT("%s"), *Message);
		}
	}
}
