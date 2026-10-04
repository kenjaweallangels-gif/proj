#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "RakisNoiseSubsystem.generated.h"

/** Одно событие шума в мире (шаг, удар тампера, техника). */
USTRUCT(BlueprintType)
struct RAKIS_API FRakisNoiseEvent
{
	GENERATED_BODY()

	FRakisNoiseEvent() = default;
	FRakisNoiseEvent(const FVector& InLocation, float InLoudness, FName InSource, float InTime = -1.f)
		: Location(InLocation), Loudness(InLoudness), Source(InSource), Time(InTime)
	{
	}

	/** Где прозвучало (мировые координаты, см). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Noise")
	FVector Location = FVector::ZeroVector;

	/** Громкость (0..1+, уже с учётом поверхности и ритма). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Noise")
	float Loudness = 0.f;

	/** Источник: "Footstep", "Thumper", "Machine"... */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Noise")
	FName Source;

	/** Время мира (UWorld::GetTimeSeconds). Если < 0 при ReportNoise — подставляется текущее. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rakis|Noise")
	float Time = -1.f;
};

/** Нативное оповещение о каждом новом событии шума (для ИИ, отладки, звука). */
DECLARE_MULTICAST_DELEGATE_OneParam(FOnRakisNoiseReported, const FRakisNoiseEvent& /*Event*/);

/**
 * Мировая «акустика» пустыни: кольцевой буфер событий шума.
 * Червь опрашивает SampleNoise; события затухают по дистанции (линейно до Radius)
 * и по времени (exp(-age/Tau), параметры в URakisNoiseTuning).
 */
UCLASS()
class RAKIS_API URakisNoiseSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	/** Зарегистрировать событие шума. Громкость ≤ 0 игнорируется. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Noise")
	void ReportNoise(const FRakisNoiseEvent& Event);

	/** Удобная обёртка для Blueprint. */
	UFUNCTION(BlueprintCallable, Category = "Rakis|Noise")
	void ReportNoiseAt(FVector Location, float Loudness, FName Source);

	/** Суммарный шум в точке (0..1+), с затуханием по времени и дистанции. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Noise")
	float SampleNoise(const FVector& Where, float Radius) const;

	/** Самое громкое (с учётом возраста) событие не старше MaxAge. false — событий нет. */
	UFUNCTION(BlueprintPure, Category = "Rakis|Noise")
	bool GetLoudestRecent(FVector& OutLocation, float MaxAge) const;

	/** Все события не старше MaxAge (новые в конце). */
	void GetRecentEvents(float MaxAge, TArray<FRakisNoiseEvent>& OutEvents) const;

	/** Текущее время мира, в котором живут события. */
	float GetNow() const;

	/**
	 * Чистая формула вклада одного события (для тестов и червя):
	 * Loudness * (1 - Distance/Radius) * exp(-Age/Tau); 0 вне радиуса или старше MaxAge.
	 */
	static float ComputeContribution(float Loudness, float Distance, float Radius, float Age, float Tau, float MaxAge);

	/** Каждое новое событие. */
	FOnRakisNoiseReported OnNoiseReported;

protected:
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override;

private:
	/** Кольцевой буфер; NextIndex — куда писать следующее событие. */
	TArray<FRakisNoiseEvent> Buffer;
	int32 NextIndex = 0;
	int32 NumEvents = 0;

	template <typename FuncType>
	void ForEachEvent(FuncType&& Func) const
	{
		const int32 Capacity = Buffer.Num();
		for (int32 i = 0; i < NumEvents; ++i)
		{
			// От самого старого к самому новому.
			const int32 Index = (NextIndex - NumEvents + i + Capacity) % Capacity;
			Func(Buffer[Index]);
		}
	}
};
