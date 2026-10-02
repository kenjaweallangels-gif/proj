#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/RakisInteractable.h"
#include "RakisInspectable.generated.h"

class USphereComponent;
class UStaticMeshComponent;
class ARakisInspectable;

/**
 * Глобальное нативное событие «игрок осмотрел POI». Параметр — LoreID (строка DT_Dialogue).
 * UI/нарратив (URakisDialogueSubsystem) подписываются на ARakisInspectable::OnInspected —
 * так у core-кода нет зависимости компиляции от Narrative/UI.
 */
DECLARE_MULTICAST_DELEGATE_OneParam(FRakisInspectDelegate, FName /*LoreID*/);

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnRakisInspected, FName, LoreID);

/**
 * Точка интереса: резьба, роспись, решётка цистерны. Взаимодействие → OnInspected(LoreID).
 * На актор автоматически вешается тег "Rakis.POI.<LoreID>" (контракт §2.4).
 */
UCLASS()
class RAKIS_API ARakisInspectable : public AActor, public IRakisInteractable
{
	GENERATED_BODY()

public:
	ARakisInspectable();

	// IRakisInteractable
	virtual FText GetInteractVerb() const override { return InteractVerb; }
	virtual bool CanInteract(ARakisCharacter* Interactor) const override;
	virtual void Interact(ARakisCharacter* Interactor) override;

	/** Глобальное событие для всех POI (статическое, нативное). */
	static FRakisInspectDelegate OnInspected;

	/** Событие конкретного POI (Blueprint). */
	UPROPERTY(BlueprintAssignable, Category = "Rakis|Inspect")
	FOnRakisInspected OnInspectedDynamic;

	UFUNCTION(BlueprintPure, Category = "Rakis|Inspect")
	FName GetLoreID() const { return LoreID; }

	UFUNCTION(BlueprintPure, Category = "Rakis|Inspect")
	bool WasInspected() const { return bInspected; }

	/** ID строки DT_Dialogue (реплика-комментарий Кайра/спутника). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Inspect")
	FName LoreID;

	/** Только один раз (после осмотра фокус больше не появляется). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Rakis|Inspect")
	bool bOneShot = false;

protected:
	virtual void OnConstruction(const FTransform& Transform) override;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Inspect")
	TObjectPtr<USphereComponent> FocusVolume;

	/** Необязательный видимый меш (обычно POI — это декаль/часть стены, меш не нужен). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Rakis|Inspect")
	TObjectPtr<UStaticMeshComponent> VisualMesh;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Inspect", meta = (ClampMin = "5"))
	float FocusRadius = 45.f;

	UPROPERTY(EditDefaultsOnly, Category = "Rakis|Inspect")
	FText InteractVerb;

private:
	bool bInspected = false;
};
