#include "World/RakisZoneSubsystem.h"

#include "Rakis.h"
#include "World/RakisZoneVolume.h"
#include "Weather/RakisWeatherSubsystem.h"
#include "Audio/RakisAudioDirector.h"
#include "Hydration/RakisHydrationComponent.h"

#include "Engine/Engine.h"
#include "Engine/LatentActionManager.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Sound/ReverbEffect.h"

URakisZoneSubsystem* URakisZoneSubsystem::Get(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World ? World->GetSubsystem<URakisZoneSubsystem>() : nullptr;
}

bool URakisZoneSubsystem::DoesSupportWorldType(const EWorldType::Type WorldType) const
{
	return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
}

void URakisZoneSubsystem::Deinitialize()
{
	RegisteredVolumes.Reset();
	ActiveStack.Reset();
	ActiveVolume.Reset();
	Super::Deinitialize();
}

float URakisZoneSubsystem::GetTimeInZone() const
{
	const UWorld* World = GetWorld();
	return World ? World->GetTimeSeconds() - ZoneEnterTime : 0.f;
}

void URakisZoneSubsystem::RegisterVolume(ARakisZoneVolume* Volume)
{
	if (!Volume)
	{
		return;
	}
	RegisteredVolumes.AddUnique(Volume);

	// Игрок может уже стоять внутри (стриминг/спавн до BeginPlay объёма).
	if (const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		if (Volume->ContainsPoint(Player->GetActorLocation()))
		{
			NotifyVolumeEntered(Volume);
		}
	}
}

void URakisZoneSubsystem::UnregisterVolume(ARakisZoneVolume* Volume)
{
	RegisteredVolumes.Remove(Volume);
	if (ActiveStack.Remove(Volume) > 0)
	{
		Resolve();
	}
}

void URakisZoneSubsystem::NotifyVolumeEntered(ARakisZoneVolume* Volume)
{
	if (!Volume)
	{
		return;
	}
	// Повторный вход поднимает объём наверх стека (последний вошедший побеждает при равном приоритете).
	ActiveStack.Remove(Volume);
	ActiveStack.Add(Volume);
	Resolve();
}

void URakisZoneSubsystem::NotifyVolumeExited(ARakisZoneVolume* Volume)
{
	if (ActiveStack.Remove(Volume) > 0)
	{
		Resolve();
	}
}

void URakisZoneSubsystem::ReevaluateFromPlayerPosition()
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player)
	{
		return;
	}
	const FVector P = Player->GetActorLocation();

	// Сохраняем порядок входа для тех, кто остался, и добавляем новых в конец.
	TArray<TWeakObjectPtr<ARakisZoneVolume>> NewStack;
	for (const TWeakObjectPtr<ARakisZoneVolume>& Weak : ActiveStack)
	{
		if (Weak.IsValid() && Weak->ContainsPoint(P))
		{
			NewStack.Add(Weak);
		}
	}
	for (const TWeakObjectPtr<ARakisZoneVolume>& Weak : RegisteredVolumes)
	{
		if (Weak.IsValid() && !NewStack.Contains(Weak) && Weak->ContainsPoint(P))
		{
			NewStack.Add(Weak);
		}
	}
	ActiveStack = MoveTemp(NewStack);
	Resolve();
}

void URakisZoneSubsystem::Resolve()
{
	ActiveStack.RemoveAll([](const TWeakObjectPtr<ARakisZoneVolume>& W) { return !W.IsValid(); });

	ARakisZoneVolume* Best = nullptr;
	for (const TWeakObjectPtr<ARakisZoneVolume>& Weak : ActiveStack)
	{
		ARakisZoneVolume* V = Weak.Get();
		// >= — при равенстве приоритета побеждает более поздний в стеке.
		if (!Best || V->Priority >= Best->Priority)
		{
			Best = V;
		}
	}

	// Вне всех объёмов — сохраняем последнюю зону.
	if (!Best || Best == ActiveVolume.Get())
	{
		return;
	}
	ApplyVolume(Best);
}

void URakisZoneSubsystem::ApplyVolume(ARakisZoneVolume* NewVolume)
{
	UWorld* World = GetWorld();
	if (!World || !NewVolume)
	{
		return;
	}

	ActiveVolume = NewVolume;
	const ERakisZone OldZone = CurrentZone;
	const ERakisZone NewZone = NewVolume->Zone;

	UE_LOG(LogRakis, Log, TEXT("Zone: активный объём %s (%s)"), *NewVolume->GetName(), *UEnum::GetValueAsString(NewZone));

	// --- Погода и интерьер (Interior01 пишет погодная подсистема — единственный писатель MPC) ---
	if (URakisWeatherSubsystem* Weather = World->GetSubsystem<URakisWeatherSubsystem>())
	{
		if (!NewVolume->WeatherPreset.IsNone())
		{
			Weather->RequestPreset(NewVolume->WeatherPreset, NewVolume->WeatherBlendSeconds);
		}
		Weather->SetInterior(NewVolume->bInterior, NewVolume->InteriorBlendSeconds);
	}

	// --- Звук ---
	if (URakisAudioDirector* Audio = World->GetSubsystem<URakisAudioDirector>())
	{
		if (NewVolume->bSetMusic)
		{
			Audio->SetMusicState(NewVolume->Music);
		}
		Audio->SetAmbienceZone(NewZone);
		Audio->SetInterior(NewVolume->bInterior);

		UReverbEffect* Reverb = nullptr;
		if (!NewVolume->Reverb.IsNull())
		{
			Reverb = NewVolume->Reverb.LoadSynchronous();
			if (!Reverb)
			{
				UE_LOG(LogRakis, Warning, TEXT("Zone: реверб %s не загрузился (%s)."), *NewVolume->Reverb.ToString(), *NewVolume->GetName());
			}
		}
		Audio->SetZoneReverb(Reverb);
	}

	// --- Вода: интерьер восстанавливает влагу ---
	if (APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		if (URakisHydrationComponent* Hydration = Player->FindComponentByClass<URakisHydrationComponent>())
		{
			Hydration->SetInterior(NewVolume->bInterior);
		}
	}

	// --- Стриминг ---
	StreamLevels(NewVolume);

	if (OldZone != NewZone)
	{
		CurrentZone = NewZone;
		ZoneEnterTime = World->GetTimeSeconds();
		OnZoneChanged.Broadcast(OldZone, NewZone);
	}
}

void URakisZoneSubsystem::StreamLevels(const ARakisZoneVolume* Volume)
{
	for (const TSoftObjectPtr<UWorld>& Level : Volume->LevelsToLoad)
	{
		if (Level.IsNull())
		{
			continue;
		}
		FLatentActionInfo Info;
		Info.CallbackTarget = this;
		Info.ExecutionFunction = GET_FUNCTION_NAME_CHECKED(URakisZoneSubsystem, OnStreamingOpFinished);
		Info.UUID = NextLatentUUID++;
		Info.Linkage = 0;
		++PendingStreamingOps;
		UGameplayStatics::LoadStreamLevelBySoftObjectPtr(this, Level, /*bMakeVisibleAfterLoad*/ true, /*bShouldBlockOnLoad*/ false, Info);
		UE_LOG(LogRakis, Log, TEXT("Zone: загрузка %s"), *Level.ToString());
	}
	for (const TSoftObjectPtr<UWorld>& Level : Volume->LevelsToUnload)
	{
		if (Level.IsNull())
		{
			continue;
		}
		FLatentActionInfo Info;
		Info.CallbackTarget = this;
		Info.ExecutionFunction = GET_FUNCTION_NAME_CHECKED(URakisZoneSubsystem, OnStreamingOpFinished);
		Info.UUID = NextLatentUUID++;
		Info.Linkage = 0;
		++PendingStreamingOps;
		UGameplayStatics::UnloadStreamLevelBySoftObjectPtr(this, Level, Info, /*bShouldBlockOnUnload*/ false);
		UE_LOG(LogRakis, Log, TEXT("Zone: выгрузка %s"), *Level.ToString());
	}
}

void URakisZoneSubsystem::OnStreamingOpFinished()
{
	PendingStreamingOps = FMath::Max(0, PendingStreamingOps - 1);
	if (PendingStreamingOps == 0)
	{
		// Новые объёмы/свет могли появиться вместе с уровнем.
		ReevaluateFromPlayerPosition();
	}
}
