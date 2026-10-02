#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "RakisInteractable.generated.h"

class ARakisCharacter;

/**
 * Интерфейс всего, с чем игрок может взаимодействовать (E / X).
 * Реализуется в C++ (обычные виртуальные функции, без BlueprintNativeEvent) —
 * Blueprint-наследники C++-классов (ARakisSealDoor и др.) получают поведение по наследству.
 */
UINTERFACE(MinimalAPI, meta = (CannotImplementInterfaceInBlueprint))
class URakisInteractable : public UInterface
{
	GENERATED_BODY()
};

class RAKIS_API IRakisInteractable
{
	GENERATED_BODY()

public:
	/** Одно слово для подсказки у прицела («Открыть», «Осмотреть»). */
	virtual FText GetInteractVerb() const { return FText::GetEmpty(); }

	/** Можно ли сейчас взаимодействовать (дверь не в движении, камень ещё не открыт...). */
	virtual bool CanInteract(ARakisCharacter* Instigator) const { return true; }

	/** Выполнить взаимодействие. */
	virtual void Interact(ARakisCharacter* Instigator) {}
};
