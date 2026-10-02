#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "RakisSandWalkComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSandStep, float, Regularity);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnSandWalkToggled, bool, bSandWalking);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnSandStutter);

/**
 * Мини-механика «походки по песку».
 * Каждый шаг регистрирует интервал; регулярность = 1 − нормированный коэффициент вариации
 * последних RegularityWindow интервалов (0 — хаос, хорошо; 1 — метроном, плохо).
 * Пока зажат SandWalk, игрок жмёт Stutter, чтобы вставить неровный полушаг/паузу и сбить ритм
 * (сам полушаг выполняет ARakisCharacter — компонент лишь разрешает и считает).
 */
UCLASS(ClassGroup = (Rakis), meta = (BlueprintSpawnableComponent))
class RAKIS_API URakisSandWalkComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	URakisSandWalkComponent();

	UFUNCTION(BlueprintPure, Category = "Rakis|SandWalk")
	bool IsSandWalking() const { return bSandWalking; }

	/** Вход/выход из походки по песку (удержание Alt/LB). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|SandWalk")
	void SetSandWalking(bool bEnable);

	/** 0 = хаос (хорошо) … 1 = метроном (плохо). */
	UFUNCTION(BlueprintPure, Category = "Rakis|SandWalk")
	float GetRhythmRegularity() const { return Regularity; }

	/** Последние интервалы между шагами, с (≤ 6, для засечек HUD; новые в конце). */
	UFUNCTION(BlueprintPure, Category = "Rakis|SandWalk")
	TArray<float> GetRecentIntervals() const;

	/** Зарегистрировать шаг (вызывает персонаж на каждый шаг). Возвращает новую регулярность. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|SandWalk")
	float RegisterStep();

	/**
	 * Запрос «сбить ритм». true — разрешено (идёт походка по песку и нет кулдауна):
	 * вызывающий должен вставить полушаг/паузу.
	 */
	UFUNCTION(BlueprintCallable, Category = "Rakis|SandWalk")
	bool TryStutter();

	/** Сброс истории ритма (телепорт, кат-сцена). */
	UFUNCTION(BlueprintCallable, Category = "Rakis|SandWalk")
	void ResetRhythm();

	/** Чистая формула регулярности: 1 − clamp(CV / CVReference); меньше 2 интервалов → 0. */
	static float ComputeRegularity(const TArray<float>& InIntervals, float CVReference = 0.35f);

	/** Каждый шаг (не только в походке по песку) — HUD обновляет засечки. */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|SandWalk")
	FOnSandStep OnSandStep;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|SandWalk")
	FOnSandWalkToggled OnSandWalkToggled;

	UPROPERTY(BlueprintAssignable, Category = "Rakis|SandWalk")
	FOnSandStutter OnStutter;

protected:
	/** Минимальная пауза между двумя «сбивками», с. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|SandWalk", meta = (ClampMin = "0"))
	float StutterCooldown = 0.2f;

	/** Сколько интервалов отдавать HUD. */
	UPROPERTY(EditDefaultsOnly, Category = "Rakis|SandWalk", meta = (ClampMin = "1", ClampMax = "16"))
	int32 HUDIntervalCount = 6;

private:
	float GetNow() const;

	TArray<float> Intervals;
	float LastStepTime = -1.f;
	float LastStutterTime = -100.f;
	float Regularity = 0.f;
	bool bSandWalking = false;
};
