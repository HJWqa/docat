import React from "react";
import threeController from "../controller/index";
import Coordinate from "./coordinate";
import SecWallinfo from "./secWallinfo";
class App extends React.Component {
  render() {
    return (
      <div>
        <Coordinate></Coordinate>
        <SecWallinfo></SecWallinfo>
        <div id="Three">
          <div id="axisContainer"></div>
        </div>
      </div>
    );
  }
  componentDidMount() {
    threeController.loadModel.apply(threeController);
    window.addEventListener("resize", threeController.updateResize);
  }
  componentWillUnmount() {
    localStorage.removeItem("pose");
    threeController.removeListener.apply(threeController);
    window.removeEventListener("resize", threeController.updateResize);
  }
}

export default App;
