"""Генератор тестовой STEP-сборки (две детали с именами) для tests/test_step_to_glb.py.
   pip install cadquery-ocp && python tools/make_test_step.py tests/data/two_brackets.step"""
import sys
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec
from OCP.TopLoc import TopLoc_Location
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDataStd import TDataStd_Name
from OCP.STEPCAFControl import STEPCAFControl_Writer
from OCP.STEPControl import STEPControl_AsIs
from OCP.IFSelect import IFSelect_RetDone
doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
st = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
asm = st.NewShape()
TDataStd_Name.Set_s(asm, TCollection_ExtendedString("ASM"))
# CAD: Z вверх, мм. Деталь 100×60(Y глубина)×70(Z высота), центр в (x, 120, 30+35)
for name, x in [("K204", -400.0), ("K205", 400.0)]:
    box = BRepPrimAPI_MakeBox(gp_Pnt(-50, -30, -35), 100, 60, 70).Shape()
    lab = st.AddShape(box, False)
    TDataStd_Name.Set_s(lab, TCollection_ExtendedString(name))
    t = gp_Trsf(); t.SetTranslation(gp_Vec(x, 120.0, 65.0))
    comp = st.AddComponent(asm, lab, TopLoc_Location(t))
    TDataStd_Name.Set_s(comp, TCollection_ExtendedString(name))
st.UpdateAssemblies()
w = STEPCAFControl_Writer(); w.SetNameMode(True)
w.Transfer(doc, STEPControl_AsIs)
assert w.Write(sys.argv[1]) == IFSelect_RetDone
print("written", sys.argv[1])
