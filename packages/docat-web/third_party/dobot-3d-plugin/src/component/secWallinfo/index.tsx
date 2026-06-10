import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ReduxState } from "../../reducer/pose";
import { TSecWallType, TWorkZoneType } from "../../protocol";
import "./index.css";
import { useTranslation } from "react-i18next";
const SecWallinfo = () => {
  const { t } = useTranslation();
  const { secWall, workZoneData } = useSelector<
    { getPose: ReduxState },
    ReduxState
  >((state) => state.getPose);
  const [secWalls, setSecWalls] = useState<TSecWallType[]>([]);
  const [workZoneDatas, setWorkZoneDatas] = useState<TWorkZoneType[]>([]);
  useEffect(() => {
    const tmpSecWalls = secWall.filter(
      (wall: TSecWallType) => wall.enable && wall.name
    );
    setSecWalls(tmpSecWalls);
  }, [secWall]);
  useEffect(() => {
    const tmpSecWalls = workZoneData.filter(
      (data: TWorkZoneType) => data.enable && data.name
    );
    setWorkZoneDatas(tmpSecWalls);
  }, [workZoneData]);
  return (
    <div className="secwall-info">
      {secWalls.length !== 0 && (
        <div>
          <span>{t("TR_WALL_START")}</span>
          {/* {secWalls.map((wall, index) => {
            return <span key={index}>{`${wall.name}  `}</span>;
          })} */}
        </div>
      )}
      {workZoneDatas.length !== 0 && (
        <div>
          <span>{t("TR_ZONE_START")}</span>
          {/* {workZoneDatas.map((workZone, index) => {
            return <span key={index}>{`${workZone.name}  `}</span>;
          })} */}
        </div>
      )}
    </div>
  );
};
export default SecWallinfo;
