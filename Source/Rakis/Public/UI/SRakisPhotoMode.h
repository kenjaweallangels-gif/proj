#pragma once

#include "CoreMinimal.h"
#include "InputCoreTypes.h"
#include "Widgets/SCompoundWidget.h"

class STextBlock;
class ARakisPhotoCamera;

/** Тексты легенды фоторежима (локализуются в ARakisHUD). */
struct FRakisPhotoModeTexts
{
	FText LegendKeyboard;
	FText LegendGamepad;
	FText FocusOff;		// «выкл» / «off»
	FText FocusLabel;	// «фокус» / «focus»
	FText RollLabel;	// «крен» / «roll»
	FText Meters;		// «м» / «m»
};

/**
 * Фоторежим: свободная камера в радиусе 15 м от точки входа, FOV, DOF (фокус/диафрагма),
 * экспозиция, крен; минимальная легенда в левом нижнем углу (docs/ui/ui_design.md §5.11).
 * Ввод обрабатывается самим виджетом (клавиатура, мышь с захватом, геймпад), поэтому
 * работает при UI-only режиме ввода и замороженном времени.
 */
class RAKIS_API SRakisPhotoMode : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRakisPhotoMode) {}
		SLATE_EVENT(FSimpleDelegate, OnExitRequested)
	SLATE_END_ARGS()

	static constexpr float MaxRadiusCm = 1500.f;

	void Construct(const FArguments& InArgs);

	/** InStartLocation — положение камеры; InAnchor — центр сферы 15 м (игрок). */
	void Activate(ARakisPhotoCamera* InCamera, const FVector& InStartLocation, const FVector& InAnchor, const FRotator& InRotation, float InFov, const FRakisPhotoModeTexts& InTexts);
	void Deactivate();
	bool IsActive() const { return bActive; }
	void SetTexts(const FRakisPhotoModeTexts& InTexts);

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnKeyUp(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;
	virtual FReply OnAnalogValueChanged(const FGeometry& MyGeometry, const FAnalogInputEvent& InAnalogInputEvent) override;
	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseButtonUp(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseMove(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual FReply OnMouseWheel(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent) override;
	virtual void OnFocusLost(const FFocusEvent& InFocusEvent) override;
	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime) override;

private:
	/** Удерживаемые «цифровые» кнопки — битовая маска. */
	enum EHeld : uint32
	{
		Held_Forward	= 1u << 0,
		Held_Back		= 1u << 1,
		Held_Left		= 1u << 2,
		Held_Right		= 1u << 3,
		Held_Up			= 1u << 4,
		Held_Down		= 1u << 5,
		Held_Fast		= 1u << 6,
		Held_FovIn		= 1u << 7,
		Held_FovOut		= 1u << 8,
		Held_FocusFar	= 1u << 9,
		Held_FocusNear	= 1u << 10,
		Held_ApOpen		= 1u << 11,
		Held_ApClose	= 1u << 12,
		Held_ExpUp		= 1u << 13,
		Held_ExpDown	= 1u << 14,
		Held_RollLeft	= 1u << 15,
		Held_RollRight	= 1u << 16,
		Held_Modifier	= 1u << 17	// A на геймпаде: плечи меняют диафрагму вместо фокуса
	};

	uint32 KeyToFlag(const FKey& Key) const;
	void ResetParameters();
	void ApplyToCamera();
	void RefreshValuesText();
	bool IsHeld(uint32 Flag) const { return (Held & Flag) != 0; }

	FSimpleDelegate OnExitRequested;
	TWeakObjectPtr<ARakisPhotoCamera> Camera;
	FRakisPhotoModeTexts Texts;

	TSharedPtr<STextBlock> ValuesText;
	TSharedPtr<STextBlock> LegendText;

	bool bActive = false;
	bool bLegendVisible = true;
	bool bLegendGamepad = false;
	uint32 Held = 0;

	// Аналоговые оси геймпада
	float LeftX = 0.f, LeftY = 0.f, RightX = 0.f, RightY = 0.f, LeftTrigger = 0.f, RightTrigger = 0.f;
	FVector2f PendingMouseDelta = FVector2f::ZeroVector;
	float PendingWheel = 0.f;

	// Параметры камеры
	FVector Anchor = FVector::ZeroVector;
	FVector Location = FVector::ZeroVector;
	float Pitch = 0.f, Yaw = 0.f, Roll = 0.f;
	float Fov = 60.f, StartFov = 60.f;
	float FocusCm = 0.f;
	float FStop = 2.8f;
	float ExposureEV = 0.f;

	float TextRefreshTimer = 0.f;
	float Opacity = 0.f;
};
