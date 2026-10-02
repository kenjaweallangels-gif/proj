#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Engine/TimerHandle.h"
#include "RakisHydrationComponent.generated.h"

class ADirectionalLight;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMoistureChanged, float, Moisture01);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnShadeChanged, bool, bInShade);

/** Где сейчас находится игрок с точки зрения жары. */
UENUM(BlueprintType)
enum class ERakisExposure : uint8
{
	Sun			UMETA(DisplayName = "Sun"),
	Shade		UMETA(DisplayName = "Shade"),
	Interior	UMETA(DisplayName = "Interior")
};

/**
 * Влага и жара игрока. Только индикатор — смерти нет (GDD §5).
 * Каждые UpdateInterval (0.25 с) по таймеру: трасса к солнцу (ADirectionalLight с тегом Rakis.Sun
 * или первый найденный), определение интерьера, пересчёт влаги и жары.
 * Интерьер: SetInterior(true) из системы зон ИЛИ пересечение с актором-объёмом с тегом "Rakis.Interior"
 * ИЛИ солнце не найдено.
 */
UCLASS(ClassGroup = (Rakis), meta = (BlueprintSpawnableComponent))
class RAKIS_API URakisHydrationComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	URakisHydrationComponent();

	UFUNCTION(BlueprintPure, Category = "Rakis|Hydration")
	float GetMoisture01() const { return Moisture01; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Hydration")
	bool IsInShade() const { return Exposure != ERakisExposure::Sun; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Hydration")
	bool IsInterior() const { return Exposure == ERakisExposure::Interior; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Hydration")
	ERakisExposure GetExposure() const { return Exposure; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Hydration")
	float GetHeat01() const { return Heat01; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Hydration")
	bool IsMaskSealed() const { return bMaskSealed; }

	UFUNCTION(BlueprintCallable, Category = "Rakis|Hydration")
	void SetMaskSealed(bool bSealed);

	/** Принудительный интерьер (вызывает система зон по ARakisZoneVolume::bInterior). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Hydration")
	void SetInterior(bool bInInterior);

	/** Персонаж сообщает о беге (расход × RunMultiplier). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Hydration")
	void SetExerting(bool bInExerting) { bExerting = bInExerting; }

	/** Пить/пополнить (торговка водой, кувшин). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Hydration")
	void AddMoisture(float Delta01);

	/**
	 * Чистая формула изменения влаги за DeltaSeconds (доля шкалы, может быть < 0).
	 * Солнце: −SunDrain × (бег ? RunMultiplier : 1) × (маска ? MaskSealedFactor : 1);
	 * тень: +ShadeRecover (при беге — 0); интерьер: +InteriorRecover.
	 */
	static float ComputeMoistureDelta(ERakisExposure InExposure, bool bRunning, bool bSealed, float DeltaSeconds,
		float SunDrainPerMinute, float ShadeRecoverPerMinute, float RunMultiplier, float MaskSealedFactor, float InteriorRecoverPerMinute);

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Hydration")
	FOnMoistureChanged OnMoistureChanged;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|Hydration")
	FOnShadeChanged OnShadeChanged;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	/** Начальное состояние маски дистикомба. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Hydration")
	bool bStartMaskSealed = true;

	/** Тег солнца (контракт §2.4). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Hydration")
	FName SunTag = TEXT("Rakis.Sun");

	/** Тег объёма-интерьера. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Hydration")
	FName InteriorTag = TEXT("Rakis.Interior");

	/** Высота точки трассировки над центром владельца, см (уровень головы). */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Hydration")
	float TraceHeightOffset = 60.f;

private:
	void UpdateHydration();
	ADirectionalLight* FindSun();
	bool IsOverlappingInteriorVolume() const;
	bool TraceSunBlocked(const ADirectionalLight* Sun) const;

	TWeakObjectPtr<ADirectionalLight> CachedSun;
	float NextSunSearchTime = 0.f;
	float LastUpdateTime = 0.f;
	float LastBroadcastMoisture = -1.f;

	float Moisture01 = 1.f;
	float Heat01 = 0.f;
	ERakisExposure Exposure = ERakisExposure::Sun;
	bool bMaskSealed = true;
	bool bForcedInterior = false;
	bool bExerting = false;

	FTimerHandle UpdateTimer;
};
