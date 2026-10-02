#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Volume.h"
#include "Core/RakisTypes.h"
#include "RakisZoneVolume.generated.h"

class UReverbEffect;

/**
 * Объём зоны среза (A1…B5). При входе/выходе игрока сообщает URakisZoneSubsystem,
 * который по стеку приоритетов выбирает активную зону и применяет её: погода, музыка,
 * интерьер (вода + MPC Interior01), реверб, стриминг подуровней.
 * Расставляется level_markup.py (контракт §2.3, §2.7 п.5).
 */
UCLASS(hidecategories = (Advanced, Attachment, Collision, Volume))
class RAKIS_API ARakisZoneVolume : public AVolume
{
	GENERATED_BODY()

public:
	ARakisZoneVolume(const FObjectInitializer& ObjectInitializer = FObjectInitializer::Get());

	/** Зона среза. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone")
	ERakisZone Zone = ERakisZone::None;

	/** Пресет погоды (DT_WeatherPresets); None — не менять. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone")
	FName WeatherPreset;

	/** Время смешивания погоды, сек. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone", meta = (ClampMin = "0.0"))
	float WeatherBlendSeconds = 8.f;

	/** Музыкальное состояние зоны. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone")
	ERakisMusicState Music = ERakisMusicState::DesertCalm;

	/** Применять ли Music при входе (false — оставить текущую музыку). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone")
	bool bSetMusic = true;

	/** Интерьер: восстановление влаги, Interior01 в MPC, без марева. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone")
	bool bInterior = false;

	/** Время перехода Interior01, сек. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone", meta = (ClampMin = "0.0"))
	float InteriorBlendSeconds = 2.f;

	/** При пересечении объёмов побеждает больший приоритет; при равенстве — последний вошедший. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone")
	int32 Priority = 0;

	/** Реверб зоны (необязательно; null — снять реверб зоны). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone|Audio")
	TSoftObjectPtr<UReverbEffect> Reverb;

	/** Подуровни, которые грузятся при входе. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone|Streaming")
	TArray<TSoftObjectPtr<UWorld>> LevelsToLoad;

	/** Подуровни, которые выгружаются при входе. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Zone|Streaming")
	TArray<TSoftObjectPtr<UWorld>> LevelsToUnload;

	/** Содержит ли объём точку (по brush-коллизии). */
	bool ContainsPoint(const FVector& Point) const;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void NotifyActorBeginOverlap(AActor* OtherActor) override;
	virtual void NotifyActorEndOverlap(AActor* OtherActor) override;

private:
	static bool IsLocalPlayerPawn(const AActor* Actor);
};
