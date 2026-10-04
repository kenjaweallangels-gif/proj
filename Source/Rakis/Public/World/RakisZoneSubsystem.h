#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/RakisTypes.h"
#include "RakisZoneSubsystem.generated.h"

class ARakisZoneVolume;

/** Игрок сменил зону (контракт §2.2: OnZoneChanged(OldZone, NewZone)). */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FRakisOnZoneChanged, ERakisZone, OldZone, ERakisZone, NewZone);

/**
 * Трекер зоны игрока.
 * Стек перекрывающихся ARakisZoneVolume: активна зона с наибольшим Priority, при равенстве — последняя вошедшая.
 * Если игрок вышел из всех объёмов — остаётся последняя зона (без «мигания» в щелях между объёмами).
 * При смене активного объёма: погода (RequestPreset), музыка/эмбиент/реверб (URakisAudioDirector),
 * интерьер (URakisHydrationComponent::SetInterior + MPC Interior01 через URakisWeatherSubsystem),
 * стриминг подуровней (LoadStreamLevelBySoftObjectPtr / UnloadStreamLevelBySoftObjectPtr).
 */
UCLASS()
class RAKIS_API URakisZoneSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	static URakisZoneSubsystem* Get(const UObject* WorldContextObject);

	virtual void Deinitialize() override;

	UFUNCTION(BlueprintPure, Category = "Rakis|World")
	ERakisZone GetPlayerZone() const { return CurrentZone; }

	/** Активный объём (может быть nullptr до первого входа). */
	UFUNCTION(BlueprintPure, Category = "Rakis|World")
	ARakisZoneVolume* GetActiveVolume() const { return ActiveVolume.Get(); }

	/** Сколько секунд игрок в текущей зоне. */
	UFUNCTION(BlueprintPure, Category = "Rakis|World")
	float GetTimeInZone() const;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|World")
	FRakisOnZoneChanged OnZoneChanged;

	// --- Вызываются ARakisZoneVolume ---
	void RegisterVolume(ARakisZoneVolume* Volume);
	void UnregisterVolume(ARakisZoneVolume* Volume);
	void NotifyVolumeEntered(ARakisZoneVolume* Volume);
	void NotifyVolumeExited(ARakisZoneVolume* Volume);

	/** Пересчитать стек по фактическому положению игрока (после телепорта/смены пешки). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|World")
	void ReevaluateFromPlayerPosition();

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

private:
	void Resolve();
	void ApplyVolume(ARakisZoneVolume* NewVolume);
	void StreamLevels(const ARakisZoneVolume* Volume);

	/** Цель FLatentActionInfo для стриминга. */
	UFUNCTION()
	void OnStreamingOpFinished();

	TArray<TWeakObjectPtr<ARakisZoneVolume>> RegisteredVolumes;
	/** Объёмы, в которых сейчас игрок, в порядке входа. */
	TArray<TWeakObjectPtr<ARakisZoneVolume>> ActiveStack;
	TWeakObjectPtr<ARakisZoneVolume> ActiveVolume;

	ERakisZone CurrentZone = ERakisZone::None;
	float ZoneEnterTime = 0.f;
	int32 NextLatentUUID = 0x52414B00; // "RAK\0" — уникальная база UUID для latent-действий
	int32 PendingStreamingOps = 0;
};
