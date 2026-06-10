import React from "react";
import { connect } from 'react-redux';
import { TPose } from "src/protocol";
import './coordinate.css'
interface Props {
  pose: TPose,
  coordinateVisible: boolean
}
const mapStateToProps = (state: any) => {
  return {
    pose: state.getPose.pose,
    coordinateVisible: state.getPose.coordinateVisible
  };

};

class Coordinate extends React.Component<Props, any>{
  render() {
    const pose: any = this.props.pose
    const poseKeys = Object.keys(pose)
    return (
      this.props.coordinateVisible ? (
        <div className={poseKeys.length > 8 ? "coordinateList coordinateList-6" : "coordinateList coordinateList-4"}>
          {
            Object.keys(pose).map((item, index) => {
              return <p key={index}><span>{item}</span>:{<span>{Number(pose[item]).toFixed(2)}</span>}</p>
            })
          }
        </div>
      ) : null
    )
  }

}

export default connect(mapStateToProps)(Coordinate);